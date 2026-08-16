// ─── Shared Input Validation ───────────────────────────────────────
// Utility functions for validating common input patterns across all API routes.

/**
 * Validate a string field with optional min/max length.
 */
export function validateString(
	value,
	{ field, min = 1, max = 5000, required = true } = {},
) {
	if (required && (value === undefined || value === null)) {
		return { ok: false, error: `${field} is required` };
	}
	if (value === undefined || value === null) return { ok: true, value };
	if (typeof value !== "string") {
		return { ok: false, error: `${field} must be a string` };
	}
	const trimmed = value.trim();
	if (required && trimmed.length === 0) {
		return { ok: false, error: `${field} cannot be empty` };
	}
	if (trimmed.length < min) {
		return { ok: false, error: `${field} must be at least ${min} characters` };
	}
	if (trimmed.length > max) {
		return { ok: false, error: `${field} must be under ${max} characters` };
	}
	return { ok: true, value: trimmed };
}

/**
 * Validate an ID field (UUID or alphanumeric).
 */
export function validateId(value, { field = "id", required = true } = {}) {
	if (!required && (value === undefined || value === null)) {
		return { ok: true, value: null };
	}
	if (!value || typeof value !== "string" || value.trim().length === 0) {
		return { ok: false, error: `Invalid ${field}` };
	}
	return { ok: true, value: value.trim() };
}

/**
 * Validate a number field with optional range.
 */
export function validateNumber(
	value,
	{ field, min, max, required = true } = {},
) {
	if (!required && (value === undefined || value === null)) {
		return { ok: true, value: null };
	}
	if (value === undefined || value === null) {
		return { ok: false, error: `${field} is required` };
	}
	const num = typeof value === "string" ? parseFloat(value) : value;
	if (typeof num !== "number" || isNaN(num)) {
		return { ok: false, error: `${field} must be a number` };
	}
	if (min !== undefined && num < min) {
		return { ok: false, error: `${field} must be at least ${min}` };
	}
	if (max !== undefined && num > max) {
		return { ok: false, error: `${field} must be at most ${max}` };
	}
	return { ok: true, value: num };
}

/**
 * Validate email format.
 */
export function validateEmail(value, { required = true } = {}) {
	const result = validateString(value, { field: "email", required, max: 254 });
	if (!result.ok) return result;
	if (result.value) {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(result.value)) {
			return { ok: false, error: "Invalid email format" };
		}
	}
	return result;
}

/**
 * Validate enum values.
 */
export function validateEnum(
	value,
	allowed,
	{ field = "value", required = true } = {},
) {
	if (!required && (value === undefined || value === null)) {
		return { ok: true, value: null };
	}
	if (!value) {
		return { ok: false, error: `${field} is required` };
	}
	if (!allowed.includes(value)) {
		return {
			ok: false,
			error: `${field} must be one of: ${allowed.join(", ")}`,
		};
	}
	return { ok: true, value };
}

/**
 * Validate a boolean field.
 */
export function validateBoolean(
	value,
	{ field = "flag", required = true } = {},
) {
	if (!required && (value === undefined || value === null)) {
		return { ok: true, value: null };
	}
	if (typeof value !== "boolean") {
		// Accept string "true"/"false"
		if (value === "true" || value === "1") return { ok: true, value: true };
		if (value === "false" || value === "0") return { ok: true, value: false };
		return { ok: false, error: `${field} must be a boolean` };
	}
	return { ok: true, value };
}

/**
 * Validate request body with a schema object.
 * Schema: { fieldName: { type: 'string'|'number'|'boolean'|'enum', required?: boolean, ... } }
 */
export function validateBody(body, schema) {
	const errors = [];
	const data = {};
	for (const [field, rules] of Object.entries(schema)) {
		const value = body?.[field];
		let result;
		switch (rules.type) {
			case "string":
				result = validateString(value, { field, ...rules });
				break;
			case "number":
				result = validateNumber(value, { field, ...rules });
				break;
			case "boolean":
				result = validateBoolean(value, { field, ...rules });
				break;
			case "enum":
				result = validateEnum(value, rules.allowed, { field, ...rules });
				break;
			case "id":
				result = validateId(value, { field, ...rules });
				break;
			default:
				result = { ok: true, value };
		}
		if (!result.ok) {
			errors.push(result.error);
		} else if (result.value !== undefined && result.value !== null) {
			data[field] = result.value;
		}
	}
	if (errors.length > 0) {
		return { ok: false, error: errors.join("; "), status: 400 };
	}
	return { ok: true, data };
}
