/**
 * Email Templates — Admin page for previewing and customizing email templates.
 *
 * Features:
 * - List all templates with category badges
 * - Preview rendered templates with example variables
 * - Edit template subject and body
 * - Send test emails
 * - Variable interpolation with conditional blocks
 */

import {
  Eye,
  Mail,
  Pencil,
  Play,
  Save,
  Send,
  Sparkles,
  Tag,
  AlertTriangle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../contexts/AppContext";
import { api } from "../../lib/api";

interface EmailTemplate {
  id: string;
  name: string;
  description: string;
  subject: string;
  body: string;
  variables: string[];
  category: "notification" | "alert" | "marketing";
}

const CATEGORY_CONFIG = {
  notification: { icon: Mail, color: "text-accent", bg: "bg-accent/10", border: "border-accent/25" },
  alert: { icon: AlertTriangle, color: "text-warn", bg: "bg-warn/10", border: "border-warn/25" },
  marketing: { icon: Sparkles, color: "text-good", bg: "bg-good/10", border: "border-good/25" },
};

const EXAMPLE_VARIABLES: Record<string, Record<string, string>> = {
  "post-solved": {
    post_title: "Broken elevator in Building A",
    post_url: "https://voicebox.app/post/abc123",
    admin_reply: "Fixed by maintenance team on July 20th",
  },
  "poll-closed": {
    poll_title: "Should we install solar panels?",
    poll_url: "https://voicebox.app/post/poll456",
  },
  "alert-critical": {
    alert_title: "Security breach detected",
    alert_message: "Unauthorized access attempt from unknown IP",
    alert_url: "https://voicebox.app/admin/alerts/789",
  },
  "alert-warning": {
    alert_title: "High error rate detected",
    alert_message: "API error rate exceeded 5% threshold",
    alert_url: "https://voicebox.app/admin/alerts/101",
  },
  "alert-info": {
    alert_title: "Scheduled maintenance",
    alert_message: "System update scheduled for 2:00 AM UTC",
    alert_url: "",
  },
  welcome: {
    app_url: "https://voicebox.app",
  },
};

export default function EmailTemplates() {
  const { toast } = useApp();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EmailTemplate | null>(null);
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch templates
  const fetchTemplates = useCallback(async () => {
    try {
      const res = await api.get<{ templates: EmailTemplate[] }>("/api/email-templates");
      setTemplates(res.templates || []);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Failed to load templates", "err");
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Preview template
  const handlePreview = useCallback(
    async (template: EmailTemplate) => {
      try {
        const vars = EXAMPLE_VARIABLES[template.id] || {};
        const res = await api.post<{ subject: string; body: string }>(
          "/api/email-templates",
          { action: "preview", id: template.id, variables: vars },
        );
        setPreview(res);
        setSelected(template);
        setEditing(false);
      } catch (e: unknown) {
        toast(e instanceof Error ? e.message : "Failed to preview", "err");
      }
    },
    [toast],
  );

  // Start editing
  const handleEdit = useCallback((template: EmailTemplate) => {
    setSelected(template);
    setEditSubject(template.subject);
    setEditBody(template.body);
    setEditing(true);
    setPreview(null);
  }, []);

  // Save changes
  const handleSave = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.put<{ ok: boolean; templates: EmailTemplate[] }>("/api/email-templates", {
        id: selected.id,
        subject: editSubject,
        body: editBody,
      }).then((d) => {
        // Trust the server echo (it clamps lengths) instead of refetching
        // and patching from local state, which could show unclamped text.
        const list = d?.templates || [];
        setTemplates(list);
        setSelected(
          list.find((t) => t.id === selected.id) ?? {
            ...selected,
            subject: editSubject,
            body: editBody,
          },
        );
      });
      toast("Template saved", "ok");
      setEditing(false);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Failed to save", "err");
    }
    setSaving(false);
  }, [selected, editSubject, editBody, toast]);

  // Send test email
  const handleTestSend = useCallback(async () => {
    if (!selected || !testEmail) return;
    setSending(true);
    try {
      const vars = EXAMPLE_VARIABLES[selected.id] || {};
      const res = await api.post<{ ok: boolean; error?: string }>(
        "/api/email-templates",
        { action: "test-send", id: selected.id, to_email: testEmail, variables: vars },
      );
      if (res.ok) {
        toast("Test email sent!", "ok");
      } else {
        toast(res.error || "Failed to send", "err");
      }
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Failed to send test", "err");
    }
    setSending(false);
  }, [selected, testEmail, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-3 mb-6">
        <Mail size={20} className="text-accent" />         <h1 className="font-display font-bold text-xl tracking-tight">
           <span className="vb-gradient-text">Email Templates</span>
         </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Template List */}
        <div className="lg:col-span-1 space-y-2">
          <h2 className="text-sm font-semibold text-ink2 mb-3">Templates</h2>
          {templates.length === 0 && (
            <p className="text-xs text-ink3 py-6 text-center">
              No templates available.
            </p>
          )}
          {templates.map((t) => {
            // Unknown categories (e.g. added server-side later) must not
            // crash the whole page — fall back to neutral styling.
            const config = CATEGORY_CONFIG[t.category] ?? CATEGORY_CONFIG.notification;
            const Icon = config.icon;
            return (
              <button
                key={t.id}
                onClick={() => handlePreview(t)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  selected?.id === t.id
                    ? "border-accent bg-accent/5"
                    : "border-border hover:border-accent/50"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon size={14} className={config.color} />
                  <span className="font-semibold text-sm">{t.name}</span>
                </div>
                <p className="text-xs text-ink3 line-clamp-1">{t.description}</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full border ${config.color} ${config.bg} ${config.border}`}
                  >
                    {t.category}
                  </span>
                  <span className="text-[10px] text-ink3">
                    {(t.variables || []).length} vars
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Preview / Edit Panel */}
        <div className="lg:col-span-2">
          {selected ? (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-display font-semibold text-lg">{selected.name}</h2>
                  <p className="text-xs text-ink3">{selected.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {editing ? (
                    <>
                      <button
                        onClick={() => setEditing(false)}
                        className="btn btn-ghost !text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="btn btn-primary !text-xs"
                      >
                        <Save size={12} />
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleEdit(selected)}
                        className="btn btn-ghost !text-xs"
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        onClick={() => handlePreview(selected)}
                        className="btn btn-ghost !text-xs"
                      >
                        <Eye size={12} /> Preview
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Variables */}
              <div className="mb-4">
                <h3 className="text-xs font-semibold text-ink2 mb-2">
                  <Tag size={12} className="inline mr-1" />
                  Variables
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {(selected.variables || []).map((v) => (
                    <span
                      key={v}
                      className="text-[11px] px-2 py-1 rounded-lg bg-surface2 text-ink2 font-mono"
                    >
                      {`{{${v}}}`}
                    </span>
                  ))}
                </div>
              </div>

              {/* Edit Mode */}
              {editing ? (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-ink2 block mb-1">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={editSubject}
                      onChange={(e) => setEditSubject(e.target.value)}
                      className="input w-full font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-ink2 block mb-1">
                      Body
                    </label>
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className="input w-full font-mono text-sm min-h-[300px]"
                      rows={12}
                    />
                  </div>
                  <p className="text-[10px] text-ink3">
                    Use {"{{variable}}"} for interpolation and {"{{#variable}}...{{/variable}}"} for
                    conditionals.
                  </p>
                </div>
              ) : preview ? (
                /* Preview Mode */
                <div className="space-y-4">
                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="bg-surface2 px-4 py-2 border-b border-border">
                      <span className="text-xs font-semibold text-ink2">Preview</span>
                    </div>
                    <div className="p-4">
                      <div className="mb-3">
                        <span className="text-[10px] font-semibold text-ink3 uppercase tracking-wider">
                          Subject
                        </span>
                        <p className="text-sm font-semibold mt-1">{preview.subject}</p>
                      </div>
                      <div className="border-t border-border pt-3">
                        <span className="text-[10px] font-semibold text-ink3 uppercase tracking-wider">
                          Body
                        </span>
                        <pre className="text-sm text-ink mt-1 whitespace-pre-wrap font-sans">
                          {preview.body}
                        </pre>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-10 text-ink3 text-sm">
                  Click "Preview" to see the rendered template
                </div>
              )}

              {/* Test Send */}
              <div className="mt-6 pt-4 border-t border-border">
                <h3 className="text-xs font-semibold text-ink2 mb-2">
                  <Send size={12} className="inline mr-1" />
                  Send Test Email
                </h3>
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="admin@example.com"
                    className="input flex-1 text-sm"
                  />
                  <button
                    onClick={handleTestSend}
                    disabled={sending || !testEmail}
                    className="btn btn-primary !text-xs"
                  >
                    <Play size={12} />
                    {sending ? "Sending..." : "Send Test"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="card p-10 text-center text-ink3">
              <Mail size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Select a template to preview and customize</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
