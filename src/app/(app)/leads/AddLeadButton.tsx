"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import Modal from "@/components/Modal";
import { createLead } from "@/lib/actions";

export default function AddLeadButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    try {
      await createLead(formData);
      setOpen(false);
      router.refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4 mr-2" />
        Add lead
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Add a new lead">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="label">Full name *</label>
            <input id="name" name="name" className="input mt-1" required placeholder="Jane Smith" />
          </div>
          <div>
            <label htmlFor="email" className="label">Email *</label>
            <input id="email" name="email" type="email" className="input mt-1" required placeholder="jane@company.com" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="phone" className="label">Phone</label>
              <input id="phone" name="phone" className="input mt-1" placeholder="+1 (555) 000-0000" />
            </div>
            <div>
              <label htmlFor="company" className="label">Company</label>
              <input id="company" name="company" className="input mt-1" placeholder="Acme Inc" />
            </div>
          </div>
          <div>
            <label htmlFor="source" className="label">Source</label>
            <select id="source" name="source" className="input mt-1">
              <option value="manual">Manual</option>
              <option value="website">Website</option>
              <option value="referral">Referral</option>
              <option value="linkedin">LinkedIn</option>
              <option value="cold_outreach">Cold Outreach</option>
            </select>
          </div>
          <div>
            <label htmlFor="notes" className="label">Notes</label>
            <textarea id="notes" name="notes" rows={3} className="input mt-1" placeholder="Any context about this lead..." />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add lead
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
