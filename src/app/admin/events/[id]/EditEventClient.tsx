"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import EventForm from '@/components/admin/events/EventForm';
import type { AdminCreateEventInput } from '@/types/schemas/event/admin';
import { Alert, Box } from '@mui/material';
import type { SerializedEvent } from '@/types/event';
import { diffPayload } from '@/lib/diffPayload';

import type { InitialData } from '@/components/admin/events/EventForm';

interface EditEventClientProps {
  event: SerializedEvent;
  canWrite?: boolean;
}

// Structural fields (nested objects/arrays) aren't diffed - EventForm rebuilds
// them from live component state on every submit, so comparing them against
// the server snapshot would produce noisy false-positives. Always sent as-is.
const STRUCTURAL_FIELDS = ["location", "products", "stayPolicy", "customFields", "schedule"] as const;

export default function EditEventClient({ event, canWrite = true }: EditEventClientProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (data: AdminCreateEventInput) => {
    setLoading(true);
    try {
      const baseline = event as unknown as Record<string, unknown>;
      const submitted = data as unknown as Record<string, unknown>;

      const scalarBaseline: Record<string, unknown> = {};
      const scalarSubmitted: Record<string, unknown> = {};
      const structuralPatch: Record<string, unknown> = {};

      for (const key of Object.keys(submitted)) {
        if ((STRUCTURAL_FIELDS as readonly string[]).includes(key)) {
          structuralPatch[key] = submitted[key];
        } else {
          scalarBaseline[key] = baseline[key];
          scalarSubmitted[key] = submitted[key];
        }
      }

      const scalarDiff = diffPayload(scalarBaseline, scalarSubmitted);
      const patch = { ...scalarDiff, ...structuralPatch };

      const response = await fetch(`/api/admin/event/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update event');
      }

      router.push('/admin/events');
      router.refresh();
    } catch (err) {
      console.error(err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ py: 4 }}>
      {!canWrite ? <Alert severity="info" sx={{ mb: 2 }}>You have read-only access. Contact the organization owner to edit this event.</Alert> : null}
      <Box component="fieldset" disabled={!canWrite} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
        <EventForm initialData={event as unknown as InitialData} onSubmit={handleSubmit} loading={loading || !canWrite} />
      </Box>
    </Box>
  );
}
