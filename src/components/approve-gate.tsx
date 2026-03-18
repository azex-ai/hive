"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveTask, rejectTask } from "@/lib/api";
import { useRouter } from "next/navigation";

interface ApproveGateProps {
  taskId: string;
}

export function ApproveGate({ taskId }: ApproveGateProps) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setLoading(true);
    setError(null);
    try {
      await approveTask(taskId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
    } finally {
      setLoading(false);
    }
  }

  async function handleReject() {
    if (!reason.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await rejectTask(taskId, reason.trim());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="text-sm text-destructive font-mono">{error}</p>
      )}

      {rejecting ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for rejection..."
            rows={3}
            className="resize-none font-mono text-sm bg-background border-border"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleReject}
              disabled={!reason.trim() || loading}
            >
              {loading ? "Rejecting..." : "Confirm Reject"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRejecting(false);
                setReason("");
              }}
              disabled={loading}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={loading}
            className="bg-emerald-700 hover:bg-emerald-600 text-white border-0"
          >
            {loading ? "Approving..." : "Approve"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setRejecting(true)}
            disabled={loading}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
