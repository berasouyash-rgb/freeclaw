import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Brain, Search, RefreshCw, Plus, Send, X,
  MessageSquare, Zap, CheckCircle, AlertTriangle, Bot, User,
  PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { api } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────
interface Conversation {
  id: string;
  title: string;
  agent_id: string;
  status: string;
  last_message_at: string;
  created_at: string;
}

interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  agent_id?: string;
  tool_calls?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
  created_at: string;
}

interface AgentOfficeData {
  agent_id: string;
  agent_id_real?: string;
  icon?: string;
  role?: string;
  description?: string;
  division?: string;
  tier?: string;
  status: 'working' | 'idle' | 'error';
  total_executions: number;
  completed: number;
  failed: number;
  running: number;
  last_activity: string;
  current_goal?: string;
  goal_status?: string;
  goal_id?: string;
}

interface ChatTab {
  id: string;
  conversation_id: string | null;
  agent_id: string | null;
  title: string;
}

// ─── Status Dot ───────────────────────────────────────────────
function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    working: 'bg-green-400 shadow-green-400/50 shadow-lg',
    idle: 'bg-gray-500',
    error: 'bg-red-400 shadow-red-400/50 shadow-lg',
  };
  return <span className={`w-2.5 h-2.5 rounded-full ${colors[status] || colors.idle}`} />;
}

// ─── Agent Card ───────────────────────────────────────────────
function AgentCard({ agent, onChat }: { agent: AgentOfficeData; onChat: () => void }) {
  const timeSince = (date: string) => {
    if (!date) return 'never';
    const secs = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    return `${Math.floor(secs / 3600)}h ago`;
  };

  const displayName = agent.role || agent.agent_id;
  const displayIcon = agent.icon || '🤖';

  return (
    <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3 hover:border-amber-500/30 transition-colors group">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={agent.status} />
          <span className="text-base">{displayIcon}</span>
          <div className="min-w-0">
            <span className="text-sm font-medium text-white truncate block">{displayName}</span>
            {agent.description && (
              <span className="text-[10px] text-gray-500 truncate block">{agent.description}</span>
            )}
          </div>
        </div>
        <button
          onClick={onChat}
          className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded hover:bg-amber-500/20 transition-all flex items-center gap-1"
        >
          <MessageSquare className="w-3 h-3" />
          Chat
        </button>
      </div>

      {agent.current_goal && (
        <div className="mb-2 px-2 py-1 bg-blue-500/5 border border-blue-500/10 rounded text-xs text-blue-300 truncate">
          Goal: {agent.current_goal}
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Zap className="w-3 h-3" /> {agent.total_executions}
        </span>
        <span className="flex items-center gap-1 text-green-400">
          <CheckCircle className="w-3 h-3" /> {agent.completed}
        </span>
        {agent.failed > 0 && (
          <span className="flex items-center gap-1 text-red-400">
            <AlertTriangle className="w-3 h-3" /> {agent.failed}
          </span>
        )}
        <span className="ml-auto text-gray-600">{timeSince(agent.last_activity)}</span>
      </div>
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  const [expanded, setExpanded] = useState(false);
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const isTool = msg.role === 'tool';

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="px-3 py-1 text-xs text-gray-500 bg-gray-800/50 rounded-full">{msg.content}</span>
      </div>
    );
  }

  if (isTool) {
    return (
      <div className="flex justify-center my-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-2 py-0.5 text-[10px] text-gray-500 bg-gray-800/30 rounded border border-gray-700/30 hover:border-gray-600 transition-colors"
        >
          Tool {expanded ? '▼' : '▶'}
        </button>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 group`}>
      <div className={`max-w-[80%] ${isUser ? 'order-2' : 'order-1'}`}>
        {/* Role badge */}
        <div className={`flex items-center gap-1.5 mb-1 ${isUser ? 'justify-end' : ''}`}>
          {isUser ? (
            <User className="w-3 h-3 text-gray-500" />
          ) : (
            <Bot className="w-3 h-3 text-amber-400" />
          )}
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">
            {isUser ? 'You' : msg.agent_id || 'Agent'}
          </span>
          <span className="text-[10px] text-gray-600">
            {new Date(msg.created_at).toLocaleTimeString()}
          </span>
        </div>

        {/* Content */}
        <div className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? 'bg-amber-500/10 border border-amber-500/20 text-white'
            : 'bg-gray-800/50 border border-gray-700/30 text-gray-200'
        }`}>
          <div className="whitespace-pre-wrap break-words">{msg.content}</div>
        </div>

        {/* Tool calls */}
        {msg.tool_calls && msg.tool_calls.length > 0 && (
          <div className="mt-1">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
            >
              {msg.tool_calls.length} tool call{msg.tool_calls.length > 1 ? 's' : ''} {expanded ? '▼' : '▶'}
            </button>
            {expanded && (
              <div className="mt-1 p-2 bg-gray-900 border border-gray-800 rounded text-[10px] text-gray-500 font-mono overflow-auto max-h-40">
                {JSON.stringify(msg.tool_calls, null, 2)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Chat Input ───────────────────────────────────────────────
function ChatInput({ onSend, disabled }: { onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-gray-700/50 bg-gray-900/80 p-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
          rows={1}
          disabled={disabled}
          className="flex-1 bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-amber-500/30 disabled:opacity-50"
          style={{ minHeight: '40px', maxHeight: '120px' }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── New Chat Modal ───────────────────────────────────────────
function NewChatModal({ agents, onSelect, onClose }: { agents: AgentOfficeData[]; onSelect: (agentId: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const filtered = agents.filter(a => a.agent_id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white">Start Chat with Agent</h3>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-3">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="w-full bg-gray-800/50 border border-gray-700/50 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/30"
            />
          </div>
          <div className="max-h-60 overflow-y-auto space-y-1">
            {filtered.map(agent => (
              <button
                key={agent.agent_id}
                onClick={() => { onSelect(agent.agent_id); onClose(); }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-gray-800/50 transition-colors"
              >
                <StatusDot status={agent.status} />
                <span className="text-sm text-white flex-1 truncate">{agent.agent_id}</span>
                <span className="text-xs text-gray-500">{agent.total_executions} runs</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-gray-500 text-sm py-4">No agents found</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main: Command Center ─────────────────────────────────────
export default function CommandCenter() {
  const [agents, setAgents] = useState<AgentOfficeData[]>([]);
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [agentFilter, setAgentFilter] = useState<'all' | 'working' | 'idle' | 'error'>('all');
  const [agentSearch, setAgentSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ─── Fetch agent office data ──────────────────────────────
  const fetchAgents = useCallback(async () => {
    try {
      const data = await api.get<{ agents: AgentOfficeData[] }>('/api/command-center?action=agent-office');
      setAgents(data.agents || []);
    } catch (e) {
      console.error('Failed to fetch agents:', e);
    }
  }, []);

  // ─── Fetch messages for a tab ─────────────────────────────
  const fetchMessages = useCallback(async (convId: string) => {
    try {
      const data = await api.get<{ messages: Message[] }>(`/api/command-center?action=conversation-messages&conversation_id=${convId}`);
      setMessages(prev => ({ ...prev, [convId]: data.messages || [] }));
    } catch (e) {
      console.error('Failed to fetch messages:', e);
    }
  }, []);

  // ─── Initial load ─────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      await fetchAgents();

      // Load saved tabs
      try {
        const tabData = await api.get<{ tabs: { id: string; conversation_id: string; conversations?: { agent_id?: string; title?: string } }[] }>('/api/command-center?action=admin-tabs');
        const loadedTabs: ChatTab[] = (tabData.tabs || []).map((t) => ({
          id: t.id,
          conversation_id: t.conversation_id,
          agent_id: t.conversations?.agent_id || null,
          title: t.conversations?.title || 'Chat',
        }));
        setTabs(loadedTabs);
        if (loadedTabs.length > 0) { const first = loadedTabs[0]; if (first) setActiveTab(first.id); }
      } catch (e: unknown) {
        console.warn('[CommandCenter] No saved tabs or load failed:', e instanceof Error ? e.message : e);
      }

      setLoading(false);
    };
    init();
  }, [fetchAgents]);

  // ─── Auto-refresh agents every 10s ────────────────────────
  useEffect(() => {
    const id = setInterval(fetchAgents, 10000);
    return () => clearInterval(id);
  }, [fetchAgents]);

  // ─── Fetch messages when tab changes ──────────────────────
  useEffect(() => {
    if (activeTab) {
      const tab = tabs.find(t => t.id === activeTab);
      if (tab?.conversation_id && !messages[tab.conversation_id]) {
        fetchMessages(tab.conversation_id);
      }
    }
  }, [activeTab, tabs, fetchMessages, messages]);

  // ─── Auto-scroll ──────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTab]);

  // ─── Save tabs whenever they change ───────────────────────
  useEffect(() => {
    if (tabs.length > 0) {
      api.post('/api/command-center', {
        action: 'admin-tabs',
        tabs: tabs.map(t => ({ conversation_id: t.conversation_id })),
      }).catch((e: unknown) => { console.warn('[CommandCenter] Failed to save tabs:', e instanceof Error ? e.message : e); });
    }
  }, [tabs]);

  // ─── Open chat with agent ─────────────────────────────────
  const openChat = async (agentId: string) => {
    // Check if already open
    const existing = tabs.find(t => t.agent_id === agentId);
    if (existing) {
      setActiveTab(existing.id);
      return;
    }

    // Get agent definition for display name
    const agentDef = agents.find(a => a.agent_id_real === agentId || a.agent_id === agentId);
    const displayName = agentDef?.role || agentId;

    // Create new conversation
    try {
      const data = await api.post<{ conversation: Conversation }>('/api/command-center', {
        action: 'conversation-create',
        agent_id: agentId,
        title: `Chat with ${displayName}`,
      });

      const newTab: ChatTab = {
        id: `tab-${Date.now()}`,
        conversation_id: data.conversation.id,
        agent_id: agentId,
        title: `Chat with ${displayName}`,
      };

      setTabs(prev => [...prev, newTab]);
      setActiveTab(newTab.id);
      setMessages(prev => ({ ...prev, [data.conversation.id]: [] }));
    } catch (e) {
      console.error('Failed to create conversation:', e);
    }
  };

  // ─── Send message ─────────────────────────────────────────
  const sendMessage = async (content: string) => {
    const tab = tabs.find(t => t.id === activeTab);
    if (!tab?.conversation_id || sending) return;

    setSending(true);

    // Add optimistic user message
    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: tab.conversation_id,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };

    setMessages(prev => ({
      ...prev,
      [tab.conversation_id!]: [...(prev[tab.conversation_id!] || []), userMsg],
    }));

    try {
      const data = await api.post<{ user_message: Message; ai_message: Message }>(
        '/api/command-center',
        { action: 'conversation-send', conversation_id: tab.conversation_id, content }
      );

      // Replace optimistic message with real ones
      setMessages(prev => ({
        ...prev,
        [tab.conversation_id!]: [
          ...(prev[tab.conversation_id!] ?? []).filter(m => m.id !== userMsg.id),
          data.user_message,
          data.ai_message,
        ],
      }));
    } catch (e) {
      console.error('Failed to send:', e);
      setMessages(prev => ({
        ...prev,
        [tab.conversation_id!]: (prev[tab.conversation_id!] ?? []).filter(m => m.id !== userMsg.id),
      }));
    }

    setSending(false);
  };

  // ─── Close tab ────────────────────────────────────────────
  const closeTab = (tabId: string) => {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tabId);
      if (activeTab === tabId) {
        setActiveTab(next.length > 0 ? next[next.length - 1]?.id ?? null : null);
      }
      return next;
    });
  };

  // ─── Filtered agents ──────────────────────────────────────
  const filteredAgents = agents
    .filter(a => agentFilter === 'all' || a.status === agentFilter)
    .filter(a => !agentSearch || a.agent_id.toLowerCase().includes(agentSearch.toLowerCase()));

  const activeTabData = tabs.find(t => t.id === activeTab);
  const activeMessages = activeTabData?.conversation_id ? messages[activeTabData.conversation_id] || [] : [];

  // ─── Loading state ────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-6 h-6 text-amber-400 animate-spin" />
        <span className="ml-3 text-gray-400">Loading Command Center...</span>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-120px)] gap-0 bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      {/* ─── Left: Agent Office ──────────────────────────── */}
      <div className={`${sidebarOpen ? 'w-[340px]' : 'w-[48px]'} flex-shrink-0 border-r border-gray-800 flex flex-col transition-all duration-200`}>
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-gray-800">
          {sidebarOpen ? (
            <>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Brain className="w-4 h-4 text-amber-400" />
                Agent Office
              </h2>
              <button onClick={() => setSidebarOpen(false)} className="p-1 text-gray-500 hover:text-white transition-colors">
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button onClick={() => setSidebarOpen(true)} className="p-1 text-gray-500 hover:text-white transition-colors w-full">
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          )}
        </div>

        {sidebarOpen && (
          <>
            {/* Filters */}
            <div className="p-2 border-b border-gray-800/50 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input
                  value={agentSearch}
                  onChange={e => setAgentSearch(e.target.value)}
                  placeholder="Search agents..."
                  className="w-full bg-gray-800/30 border border-gray-700/30 rounded-md pl-8 pr-2 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/30"
                />
              </div>
              <div className="flex gap-1">
                {(['all', 'working', 'idle', 'error'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setAgentFilter(f)}
                    className={`px-2 py-1 text-[10px] rounded font-medium transition-colors ${
                      agentFilter === f ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Agent Grid */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {filteredAgents.length === 0 ? (
                <div className="text-center py-8">
                  <Brain className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                  <p className="text-gray-500 text-xs">No agents found</p>
                </div>
              ) : (
                filteredAgents.map(agent => (
                  <AgentCard
                    key={agent.agent_id}
                    agent={agent}
                    onChat={() => openChat(agent.agent_id)}
                  />
                ))
              )}
            </div>

            {/* Stats footer */}
            <div className="p-2 border-t border-gray-800 text-[10px] text-gray-600 flex justify-between">
              <span>{agents.length} agents</span>
              <span>{agents.filter(a => a.status === 'working').length} active</span>
            </div>
          </>
        )}
      </div>

      {/* ─── Right: AI Playground ────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab Bar */}
        <div className="flex items-center border-b border-gray-800 bg-gray-900/50">
          <div className="flex-1 flex overflow-x-auto">
            {tabs.map(tab => {
              const agentDef = agents.find(a => a.agent_id_real === tab.agent_id || a.agent_id === tab.agent_id);
              const tabIcon = agentDef?.icon || '🤖';
              const tabLabel = agentDef?.role || tab.agent_id || 'Chat';
              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 text-xs cursor-pointer border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'border-amber-400 text-amber-400 bg-amber-400/5'
                      : 'border-transparent text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <span>{tabIcon}</span>
                  <span className="truncate max-w-[100px]">{tabLabel}</span>
                  <button
                    onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                    className="p-0.5 hover:bg-gray-700/50 rounded transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            onClick={() => setShowNewChat(true)}
            className="p-2 text-gray-500 hover:text-amber-400 transition-colors flex-shrink-0"
            title="New Chat"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Chat Area */}
        {activeTab && activeTabData ? (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  {(() => {
                    const agentDef = agents.find(a => a.agent_id_real === activeTabData.agent_id || a.agent_id === activeTabData.agent_id);
                    return (
                      <>
                        <span className="text-4xl mb-3">{agentDef?.icon || '🤖'}</span>
                        <h3 className="text-sm font-medium text-gray-400">Chat with {agentDef?.role || activeTabData.agent_id}</h3>
                        {agentDef?.description && (
                          <p className="text-xs text-gray-600 mt-1 max-w-xs">{agentDef.description}</p>
                        )}
                        <p className="text-xs text-gray-600 mt-2">Send a message to start the conversation</p>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <>
                  {activeMessages.map(msg => (
                    <MessageBubble key={msg.id} msg={msg} />
                  ))}
                  {sending && (
                    <div className="flex justify-start mb-3">
                      <div className="bg-gray-800/50 border border-gray-700/30 rounded-lg px-3 py-2">
                        <div className="flex gap-1">
                          <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input */}
            <ChatInput onSend={sendMessage} disabled={sending} />
          </div>
        ) : (
          /* Empty State */
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-amber-500/5 border border-amber-500/10 rounded-xl flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-amber-400/50" />
            </div>
            <h3 className="text-lg font-medium text-gray-300 mb-1">AI Playground</h3>
            <p className="text-sm text-gray-500 max-w-sm">
              Select an agent from the left panel or click <strong className="text-amber-400">+ New Chat</strong> to start a conversation
            </p>
            <p className="text-xs text-gray-600 mt-3">Multiple tabs supported — chat with several agents side by side</p>
          </div>
        )}
      </div>

      {/* ─── New Chat Modal ──────────────────────────────── */}
      {showNewChat && (
        <NewChatModal
          agents={agents}
          onSelect={openChat}
          onClose={() => setShowNewChat(false)}
        />
      )}
    </div>
  );
}
