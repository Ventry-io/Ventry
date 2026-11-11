"use client";

import { useEffect, useState } from 'react';
import { 
  Box, 
  Button, 
  Typography, 
  Chip, 
  IconButton, 
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert
} from '@mui/material';
import { 
  DataGrid, 
  type GridColDef, 
  type GridRenderCellParams 
} from '@mui/x-data-grid';
import { 
  Edit, 
  Delete, 
  Add, 
  Visibility,
  QrCodeScanner,
  Badge
} from '@mui/icons-material';
import Link from 'next/link';
import type { SerializedEvent } from '@/types/event';

interface EventListProps {
  initialEvents: SerializedEvent[];
}

export default function EventList({ initialEvents }: EventListProps) {
  const [events, setEvents] = useState<SerializedEvent[]>(initialEvents);
  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!deleteId) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/event/${deleteId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete event');
      }

      setEvents(events.filter(e => e.id !== deleteId));
      setDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const columns: GridColDef[] = [
    { field: 'id', headerName: 'ID', width: 70 },
    { field: 'name', headerName: 'Event Name', flex: 1, renderCell: (params: GridRenderCellParams) => <Link href={`/admin?eventId=${params.row.id}`}>{params.row.name}</Link> },
    { 
      field: 'startDate', 
      headerName: 'Starts', 
      width: 180,
      valueGetter: (value) => new Date(value as string).toLocaleString()
    },
    { 
      field: 'status', 
      headerName: 'Status', 
      width: 120,
      renderCell: (params: GridRenderCellParams) => {
        const status = params.value as string;
        let color: "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" = "default";
        if (status === 'PUBLISHED') color = "success";
        if (status === 'DRAFT') color = "warning";
        if (status === 'CANCELLED') color = "error";
        return <Chip label={status} color={color} size="small" />;
      }
    },
    { 
      field: 'registrations', 
      headerName: 'Regs', 
      width: 100,
      valueGetter: (_, row) => (row as SerializedEvent)._count?.registrations || 0
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 230,
      sortable: false,
      renderCell: (params: GridRenderCellParams) => (
        <Stack direction="row" spacing={1}>
          <IconButton 
            size="small" 
            component={Link} 
            href={`/admin/events/${params.row.id}`}
            title="Edit"
          >
            <Edit fontSize="small" />
          </IconButton>
          <IconButton 
            size="small" 
            onClick={() => window.open(`/events/${params.row.id}`, '_blank')}
            title="View Public"
          >
            <Visibility fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            component={Link}
            href={`/admin/events/${params.row.id}/check-in`}
            title="Check-in"
          >
            <QrCodeScanner fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            component={Link}
            href={`/admin/events/${params.row.id}/badges`}
            title="Badges"
          >
            <Badge fontSize="small" />
          </IconButton>
          <IconButton 
            size="small" 
            color="error" 
            onClick={() => setDeleteId(params.row.id as number)}
            title="Delete"
          >
            <Delete fontSize="small" />
          </IconButton>
        </Stack>
      )
    }
  ];

  return (
    <Box sx={{ height: 600, width: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Events</Typography>
        <Button 
          variant="contained" 
          startIcon={<Add />} 
          component={Link} 
          href="/admin/events/create"
        >
          Create Event
        </Button>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <DataGrid
        rows={events}
        columns={columns}
        initialState={{
          pagination: {
            paginationModel: { page: 0, pageSize: 10 },
          },
        }}
        pageSizeOptions={[5, 10, 25]}
        disableRowSelectionOnClick
      />

      {/* Delete Confirmation */}
      <Dialog open={!!deleteId} onClose={() => !loading && setDeleteId(null)}>
        <DialogTitle>Delete Event?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this event? This action cannot be undone if there are no registrations.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)} disabled={loading}>Cancel</Button>
          <Button onClick={() => void handleDelete()} color="error" variant="contained" disabled={loading}>
            {loading ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
