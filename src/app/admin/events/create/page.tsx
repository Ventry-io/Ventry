"use client";

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import EventForm from '@/components/admin/events/EventForm';
import type { AdminCreateEventInput } from '@/types/schemas/event/admin';
import { Box } from '@mui/material';
import PageLoadingState from '@/components/common/PageLoadingState';

export default function CreateEventPage() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (data: AdminCreateEventInput) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create event');
      }

      const created = await response.json();
      router.push(`/admin?eventId=${created.event.id}`);
      router.refresh();
    } catch (err) {
      console.error(err);
      throw err; // Re-throw to show in form alert
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ py: 4 }}>
      <Suspense fallback={<PageLoadingState />}>
        <EventForm onSubmit={handleSubmit} loading={loading} />
      </Suspense>
    </Box>
  );
}
