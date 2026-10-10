"""
Worker Locks — Prevent concurrent modification of the same resource.

Two workers must not simultaneously modify the same resource.
Uses asyncio locks with TTL-based expiry for in-process locking.
In production, this would use Redis or PostgreSQL advisory locks.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)


class ResourceLock:
    """A lock on a specific resource (e.g., 'database:reports', 'cache:posts')."""

    def __init__(self, resource: str, holder: str, ttl_seconds: int = 300):
        self.resource = resource
        self.holder = holder
        self.acquired_at = time.monotonic()
        self.ttl_seconds = ttl_seconds

    @property
    def is_expired(self) -> bool:
        return (time.monotonic() - self.acquired_at) > self.ttl_seconds

    def __repr__(self) -> str:
        age = time.monotonic() - self.acquired_at
        return f"ResourceLock({self.resource}, holder={self.holder}, age={age:.0f}s)"


class LockManager:
    """
    Manages resource locks across workers.

    Usage:
        lock_mgr = get_lock_manager()
        if await lock_mgr.acquire("cache:reports", "cache-optimizer", ttl=60):
            try:
                # Safe to modify cache:reports
                ...
            finally:
                await lock_mgr.release("cache:reports", "cache-optimizer")
        else:
            # Another worker owns this resource — skip or queue
            pass
    """

    def __init__(self):
        self._locks: dict[str, ResourceLock] = {}
        self._async_locks: dict[str, asyncio.Lock] = {}
        self._stats = {
            "acquisitions": 0,
            "releases": 0,
            "conflicts": 0,
            "expired": 0,
        }

    def _get_async_lock(self, resource: str) -> asyncio.Lock:
        """Get or create an asyncio.Lock for a resource."""
        if resource not in self._async_locks:
            self._async_locks[resource] = asyncio.Lock()
        return self._async_locks[resource]

    async def acquire(self, resource: str, holder: str, ttl: int = 300) -> bool:
        """
        Try to acquire a lock on a resource.

        Returns True if lock acquired, False if resource is already locked.
        """
        # Clean expired locks
        self._cleanup_expired()

        if resource in self._locks:
            existing = self._locks[resource]
            if existing.is_expired:
                # Expired lock — remove and allow re-acquisition
                self._stats["expired"] += 1
                logger.warning(f"[LockManager] Expired lock on {resource} (was held by {existing.holder})")
                del self._locks[resource]
            else:
                if existing.holder != holder:
                    self._stats["conflicts"] += 1
                    logger.warning(
                        f"[LockManager] Conflict on {resource}: "
                        f"{holder} wants lock but {existing.holder} holds it"
                    )
                    return False
                # Same holder re-acquiring — refresh TTL
                self._locks[resource] = ResourceLock(resource, holder, ttl)
                return True

        # Acquire the lock
        self._locks[resource] = ResourceLock(resource, holder, ttl)
        self._stats["acquisitions"] += 1
        logger.info(f"[LockManager] {holder} acquired lock on {resource} (TTL={ttl}s)")
        return True

    async def release(self, resource: str, holder: str) -> bool:
        """Release a lock. Returns True if released, False if not held by this holder."""
        if resource not in self._locks:
            return False

        existing = self._locks[resource]
        if existing.holder != holder:
            logger.warning(
                f"[LockManager] {holder} tried to release {resource} "
                f"but it's held by {existing.holder}"
            )
            return False

        del self._locks[resource]
        self._stats["releases"] += 1
        logger.info(f"[LockManager] {holder} released lock on {resource}")
        return True

    def is_locked(self, resource: str) -> bool:
        """Check if a resource is currently locked."""
        self._cleanup_expired()
        return resource in self._locks

    def get_holder(self, resource: str) -> Optional[str]:
        """Get the current holder of a lock."""
        self._cleanup_expired()
        lock = self._locks.get(resource)
        return lock.holder if lock else None

    def _cleanup_expired(self):
        """Remove expired locks."""
        expired = [r for r, lock in self._locks.items() if lock.is_expired]
        for resource in expired:
            lock = self._locks.pop(resource)
            self._stats["expired"] += 1
            logger.info(f"[LockManager] Cleaned expired lock: {lock}")

    def get_stats(self) -> dict:
        """Get lock manager statistics."""
        self._cleanup_expired()
        return {
            **self._stats,
            "active_locks": len(self._locks),
            "active_resources": list(self._locks.keys()),
        }


# ─── Singleton ──────────────────────────────────────────────────────

_lock_manager: Optional[LockManager] = None


def get_lock_manager() -> LockManager:
    global _lock_manager
    if _lock_manager is None:
        _lock_manager = LockManager()
    return _lock_manager
