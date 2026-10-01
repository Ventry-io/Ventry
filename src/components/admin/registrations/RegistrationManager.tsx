"use client";

import { useState, useEffect, useCallback } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  Stack, 
  Chip, 
  IconButton, 
  TextField, 
  MenuItem, 
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Alert,
  Divider,
  Avatar,
  CircularProgress,
  Switch,
  FormControlLabel
} from '@mui/material';
import { 
  DataGrid, 
  type GridColDef, 
  type GridRenderCellParams 
} from '@mui/x-data-grid';
import { 
  Edit, 
  CheckCircle, 
  FilterList,
  History as HistoryIcon,
  Receipt,
  Print
} from '@mui/icons-material';

interface Registration {
  id: string;
  ticketId: number;
  crewDepartment?: string | null;
  crewRole?: string | null;
  canWrite?: boolean;
  canApprove?: boolean;
  canManageFinances?: boolean;
  status: 'PENDING' | 'APPROVED' | 'CONFIRMED' | 'CANCELLED' | 'WAITLISTED';
  preferences: {
    productId?: string;
    productIds?: string[];
    accommodationId?: string;
    needsHotel?: boolean;
    earlyArrival?: boolean;
    lateDeparture?: boolean;
    [key: string]: string | string[] | number | boolean | undefined | null;
  };
  customFieldData: {
    [key: string]: string | number | boolean | undefined | null;
  };
  notes: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
  event: {
    id: number;
    name: string;
  };
  registrationItems: Array<{
    id: string;
    productId: string;
    product: {
      id: string;
      name: string;
      price: number;
      type: 'TICKET' | 'ACCOMMODATION' | 'ADDON';
    };
  }>;
  waitlistEntries: Array<{
    id: string;
    productId: string;
    product: {
      id: string;
      name: string;
      price: number;
      type: 'TICKET' | 'ACCOMMODATION' | 'ADDON';
    };
  }>;
  payments: Array<{
    id: string;
    amount: number;
    paymentStatus: string;
    paymentProvider: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

interface HistoryItem {
  id: string;
  action: string;
  changes: Array<{ label: string; old: string; new: string }>;
  notes: string | null;
  createdAt: string;
  changedBy: {
    user: {
      name: string | null;
      email: string;
    };
  } | null;
}

interface FullEvent {
  id: number;
  name: string;
  products: Array<{ id: string; name: string; price: number; type: 'TICKET' | 'ACCOMMODATION' | 'ADDON' }>;
  customFields: Array<{ id: string; label: string; type: 'text' | 'number' | 'boolean' | 'select'; options?: string[] }>;
}

function resolveSelectedTicketId(reg: Registration) {
  const fromItems = reg.registrationItems.find((item) => item.product.type === 'TICKET')?.productId;
  if (fromItems) {
    return fromItems;
  }

  const prefTicket = reg.preferences?.productId;
  if (prefTicket) {
    return prefTicket;
  }

  return '';
}

export default function RegistrationManager() {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [financeNotice, setFinanceNotice] = useState<{ severity: 'info' | 'warning' | 'success'; message: string } | null>(null);
  const [selectedReg, setSelectedReg] = useState<Registration | null>(null);
  const [fullEvent, setFullEvent] = useState<FullEvent | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [eventLoading, setEventLoading] = useState(false);

  // History and Payment dialogs
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);

  const [statusConfirmation, setStatusConfirmation] = useState<{ id: string; status: string } | null>(null);
  
  // Filter states
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const fetchRegistrations = useCallback(async () => {
    setLoading(true);
    try {
      const url = statusFilter === 'ALL' 
        ? '/api/admin/registrations' 
        : `/api/admin/registrations?status=${statusFilter}`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch registrations');
      const data = await response.json();
      setRegistrations(data.registrations);
    } catch (_err) {
      setError('Error loading registrations');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchEventDetails = async (eventId: number) => {
    setEventLoading(true);
    try {
      const response = await fetch(`/api/admin/event/${eventId}`);
      if (response.ok) {
        const data = await response.json();
        setFullEvent(data.event);
      }
    } catch (err) {
      console.error("Failed to fetch event details", err);
    } finally {
      setEventLoading(false);
    }
  };

  const handleOpenEdit = async (reg: Registration) => {
    const selectedTicketId = resolveSelectedTicketId(reg);
    const selectedAccommodationId =
      reg.registrationItems.find((item) => item.product.type === 'ACCOMMODATION')?.productId ||
      reg.preferences?.accommodationId ||
      '';
    const selectedProductIds = [
      ...new Set(reg.registrationItems.map((item) => item.productId)),
    ];

    setSelectedReg({
      ...reg,
      preferences: {
        ...reg.preferences,
        productId: selectedTicketId || undefined,
        accommodationId: selectedAccommodationId || undefined,
        productIds: selectedProductIds,
      },
    });
    setEditDialogOpen(true);
    await fetchEventDetails(reg.event.id);
  };

  const fetchHistory = async (id: string) => {
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/admin/registrations/${id}/history`);
      if (response.ok) {
        const data = await response.json();
        setHistoryItems(data.history);
        setHistoryOpen(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleOpenPayment = (reg: Registration) => {
    setSelectedReg(reg);
    setPaymentDialogOpen(true);
  };

  const handlePrintInvoice = () => {
    window.print();
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetching in effect is intentional
    void fetchRegistrations();
  }, [fetchRegistrations]);

  const handleUpdateStatus = async (id: string, status: string, bypassWarning = false) => {
    const reg = registrations.find(r => r.id === id);
    if (!reg || reg.status === status) return;

    // Warning if approving unpaid registration
    if (status === 'APPROVED' && !bypassWarning) {
      const latestPayment = reg.payments[0];
      if (!latestPayment || latestPayment.paymentStatus !== 'COMPLETED') {
        setStatusConfirmation({ id, status });
        return;
      }
    }

    try {
      const response = await fetch(`/api/admin/registrations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (response.ok) {
        await fetchRegistrations();
        setStatusConfirmation(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReg) return;

    try {
      const response = await fetch(`/api/admin/registrations/${selectedReg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: selectedReg.status,
          paymentStatus: selectedReg.payments[0]?.paymentStatus,
          paymentAmount: selectedReg.payments[0]?.amount,
          notes: selectedReg.notes,
          preferences: selectedReg.preferences,
          customFieldData: selectedReg.customFieldData
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.finance?.action === 'UPCHARGE_REQUIRED') {
          setFinanceNotice({
            severity: 'info',
            message: `Registration updated. Additional payment required: ${data.finance.amount}EUR. User should complete the new payment request.`,
          });
        } else if (data.finance?.action === 'MANUAL_REFUND_RECOMMENDED') {
          setFinanceNotice({
            severity: 'warning',
            message: `Registration updated. Overpayment detected (${data.finance.amount}EUR). Review and process refund manually.`,
          });
        } else {
          setFinanceNotice({
            severity: 'success',
            message: 'Registration updated with no outstanding balance changes.',
          });
        }

        setEditDialogOpen(false);
        await fetchRegistrations();
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to update registration');
      }
    } catch (err) {
      console.error(err);
      setError('Failed to update registration');
    }
  };

  const columns: GridColDef[] = [
    { field: 'ticketId', headerName: 'Ticket', width: 100, valueGetter: (v) => `#${v}` },
    { 
      field: 'user', 
      headerName: 'Attendee', 
      minWidth: 250,
      renderCell: (params: GridRenderCellParams) => (
        <Stack direction="row" alignItems="center" spacing={1}>
          <Avatar src={params.row.user.image} sx={{ width: 32, height: 32 }} />
          <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: '20px' }}>
            <Typography variant="body2" sx={{ lineHeight: 1.2, fontWeight: 'bold' }}>{params.row.user.name || 'Anonymous'}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>{params.row.user.email}</Typography>
          </Box>
        </Stack>
      )
    },
    { field: 'event', headerName: 'Event', width: 150, valueGetter: (_, row) => (row as Registration).event.name },
    { 
      field: 'status', 
      headerName: 'Status', 
      width: 130,
      renderCell: (params: GridRenderCellParams) => {
        const s = params.value as string;
        let color: "warning" | "info" | "success" | "error" = "info";
        if (s === 'PENDING') color = "warning";
        if (s === 'APPROVED') color = "info";
        if (s === 'CONFIRMED') color = "success";
        if (s === 'CANCELLED') color = "error";
        return <Chip label={s} size="small" color={color} />;
      }
    },
    {
      field: 'payment',
      headerName: 'Payment',
      width: 150,
      renderCell: (params: GridRenderCellParams) => {
        const p = params.row.payments[0];
        if (!p) return <Typography variant="caption">-</Typography>;
        return (
          <Button 
            size="small" 
            variant="text" 
            onClick={() => handleOpenPayment(params.row as Registration)}
            sx={{ textTransform: 'none' }}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="body2">{p.amount}€</Typography>
              <Chip 
                label={p.paymentStatus} 
                size="small" 
                variant="outlined"
                color={p.paymentStatus === 'COMPLETED' ? 'success' : 'default'} 
              />
            </Stack>
          </Button>
        );
      }
    },
    {
      field: 'crew',
      headerName: 'Crew department / role',
      width: 210,
      valueGetter: (_value, row) => [row.crewDepartment, row.crewRole].filter(Boolean).join(' · ') || '—',
    },
    {
      field: 'selection',
      headerName: 'Selection',
      minWidth: 260,
      flex: 1,
      sortable: false,
      renderCell: (params: GridRenderCellParams) => {
        const row = params.row as Registration;
        const names = row.registrationItems.map((item) => item.product.name);
        if (names.length === 0) {
          return <Typography variant="caption">No items</Typography>;
        }

        return (
          <Typography variant="body2" noWrap title={names.join(', ')}>
            {names.join(', ')}
          </Typography>
        );
      }
    },
    {
      field: 'history_btn',
      headerName: 'History',
      width: 80,
      renderCell: (params: GridRenderCellParams) => (
        <IconButton size="small" onClick={() => void fetchHistory(params.row.id)}>
          <HistoryIcon fontSize="small" />
        </IconButton>
      )
    },
    {
      field: 'actions',
      headerName: 'Approval',
      width: 120,
      renderCell: (params: GridRenderCellParams) => {
        const s = params.row.status;
        if (s === 'PENDING' && params.row.canApprove !== false) {
          return (
            <IconButton color="success" onClick={() => void handleUpdateStatus(params.row.id, 'APPROVED')} title="Approve">
              <CheckCircle />
            </IconButton>
          );
        }
        return null;
      }
    },
    {
      field: 'manage',
      headerName: 'Manage',
      width: 80,
      renderCell: (params: GridRenderCellParams) => (
        <IconButton aria-label="Edit registration" disabled={params.row.canWrite === false} onClick={() => void handleOpenEdit(params.row as Registration)}>
          <Edit fontSize="small" />
        </IconButton>
      )
    }
  ];

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Registration Management</Typography>
        <Stack direction="row" spacing={2} alignItems="center">
          <FilterList color="action" />
          <TextField
            select
            size="small"
            label="Filter by Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="ALL">All Registrations</MenuItem>
            <MenuItem value="PENDING">Pending Approval</MenuItem>
            <MenuItem value="APPROVED">Approved (Unpaid)</MenuItem>
            <MenuItem value="CONFIRMED">Confirmed (Paid)</MenuItem>
            <MenuItem value="CANCELLED">Cancelled</MenuItem>
          </TextField>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {financeNotice && <Alert severity={financeNotice.severity} sx={{ mb: 2 }}>{financeNotice.message}</Alert>}

      <Paper sx={{ height: 600, width: '100%' }}>
        <DataGrid
          rows={registrations}
          columns={columns}
          loading={loading}
          rowHeight={70}
          disableRowSelectionOnClick
          pageSizeOptions={[10, 25, 50]}
          initialState={{
            pagination: { paginationModel: { pageSize: 10 } }
          }}
        />
      </Paper>

      {/* Edit Registration Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Edit Registration: {selectedReg?.user.email}</DialogTitle>
        <DialogContent dividers>
          {eventLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}
          
          {selectedReg && !eventLoading && (
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="subtitle2" color="text.secondary">Registration Status</Typography>
                <TextField
                  select
                  fullWidth
                  value={selectedReg.status}
                  onChange={(e) => setSelectedReg({...selectedReg, status: e.target.value as 'PENDING' | 'APPROVED' | 'CONFIRMED' | 'CANCELLED' | 'WAITLISTED'})}
                  sx={{ mt: 1 }}
                >
                  <MenuItem value="PENDING">Pending Approval</MenuItem>
                  <MenuItem value="APPROVED">Approved</MenuItem>
                  <MenuItem value="CONFIRMED">Confirmed</MenuItem>
                  <MenuItem value="WAITLISTED">Waitlisted</MenuItem>
                  <MenuItem value="CANCELLED">Cancelled</MenuItem>
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="subtitle2" color="text.secondary">Payment Status Override</Typography>
                <TextField
                  select
                  fullWidth
                  disabled={selectedReg.canManageFinances === false}
                  helperText={selectedReg.canManageFinances === false ? 'Finances permission required to change payments.' : undefined}
                  value={selectedReg.payments[0]?.paymentStatus || 'PENDING'}
                  onChange={(e) => {
                    const newPayments = [...selectedReg.payments];
                    if (newPayments[0]) {
                      newPayments[0].paymentStatus = e.target.value;
                      setSelectedReg({...selectedReg, payments: newPayments});
                    }
                  }}
                  sx={{ mt: 1 }}
                >
                  <MenuItem value="PENDING">Pending</MenuItem>
                  <MenuItem value="COMPLETED">Completed (Paid)</MenuItem>
                  <MenuItem value="FAILED">Failed</MenuItem>
                  <MenuItem value="REFUNDED">Refunded</MenuItem>
                </TextField>
              </Grid>

              {/* Preferences Section */}
              <Grid size={{ xs: 12 }}>
                <Divider sx={{ my: 1 }} />
                <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>Registration Details</Typography>
                
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12 }}>
                    <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                      Current confirmed selection
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {selectedReg.registrationItems.length > 0 ? (
                        selectedReg.registrationItems.map((item) => (
                          <Chip
                            key={item.id}
                            label={`${item.product.name} (${item.product.price}EUR)`}
                            color={item.product.type === 'TICKET' ? 'primary' : 'default'}
                            variant={item.product.type === 'TICKET' ? 'filled' : 'outlined'}
                            size="small"
                          />
                        ))
                      ) : (
                        <Typography variant="body2" color="text.secondary">No confirmed products</Typography>
                      )}
                    </Stack>
                    {selectedReg.waitlistEntries.length > 0 && (
                      <Box sx={{ mt: 1.5 }}>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          Waitlisted items
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          {selectedReg.waitlistEntries.map((item) => (
                            <Chip
                              key={item.id}
                              label={item.product.name}
                              color="warning"
                              variant="outlined"
                              size="small"
                            />
                          ))}
                        </Stack>
                      </Box>
                    )}
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <TextField
                      select
                      fullWidth
                      label="Badge Tier"
                      value={selectedReg.preferences?.productId || ''}
                      onChange={(e) => setSelectedReg({
                        ...selectedReg, 
                        preferences: {
                          ...selectedReg.preferences,
                          productId: e.target.value,
                          productIds: Array.from(
                            new Set([
                              e.target.value,
                              ...(selectedReg.preferences?.productIds || []).filter((id) => id !== selectedReg.preferences?.productId),
                            ]),
                          ),
                        }
                      })}
                    >
                      {fullEvent?.products.filter((p) => p.type === 'TICKET').map(p => (
                        <MenuItem key={p.id} value={p.id}>{p.name} ({p.price}€)</MenuItem>
                      ))}
                    </TextField>
                  </Grid>
                  
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Stack spacing={1}>
                      <FormControlLabel
                        control={
                          <Switch 
                            checked={!!selectedReg.preferences?.needsHotel} 
                            onChange={(e) => setSelectedReg({
                              ...selectedReg,
                              preferences: { ...selectedReg.preferences, needsHotel: e.target.checked }
                            })}
                          />
                        }
                        label="Needs Hotel"
                      />
                      {selectedReg.preferences?.needsHotel && (
                        <Stack direction="row" spacing={2}>
                          <FormControlLabel
                            control={
                              <Switch 
                                size="small"
                                checked={!!selectedReg.preferences?.earlyArrival} 
                                onChange={(e) => setSelectedReg({
                                  ...selectedReg,
                                  preferences: { ...selectedReg.preferences, earlyArrival: e.target.checked }
                                })}
                              />
                            }
                            label="Early Arrival"
                          />
                          <FormControlLabel
                            control={
                              <Switch 
                                size="small"
                                checked={!!selectedReg.preferences?.lateDeparture} 
                                onChange={(e) => setSelectedReg({
                                  ...selectedReg,
                                  preferences: { ...selectedReg.preferences, lateDeparture: e.target.checked }
                                })}
                              />
                            }
                            label="Late Departure"
                          />
                        </Stack>
                      )}
                    </Stack>
                  </Grid>
                </Grid>
              </Grid>

              {/* Custom Fields Section */}
              {fullEvent?.customFields && fullEvent.customFields.length > 0 && (
                <Grid size={{ xs: 12 }}>
                  <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>Additional Answers</Typography>
                  <Grid container spacing={2}>
                    {fullEvent.customFields.map(field => (
                      <Grid key={field.id} size={{ xs: 12, md: 6 }}>
                        {field.type === 'boolean' ? (
                          <FormControlLabel
                            control={
                              <Switch 
                                checked={!!selectedReg.customFieldData?.[field.id]} 
                                onChange={(e) => setSelectedReg({
                                  ...selectedReg,
                                  customFieldData: { ...selectedReg.customFieldData, [field.id]: e.target.checked }
                                })}
                              />
                            }
                            label={field.label}
                          />
                        ) : field.type === 'select' ? (
                          <TextField
                            select
                            fullWidth
                            size="small"
                            label={field.label}
                            value={selectedReg.customFieldData?.[field.id] || ''}
                            onChange={(e) => setSelectedReg({
                              ...selectedReg,
                              customFieldData: { ...selectedReg.customFieldData, [field.id]: e.target.value }
                            })}
                          >
                            {field.options?.map(opt => (
                              <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                            ))}
                          </TextField>
                        ) : (
                          <TextField
                            fullWidth
                            size="small"
                            label={field.label}
                            type={field.type === 'number' ? 'number' : 'text'}
                            value={selectedReg.customFieldData?.[field.id] || ''}
                            onChange={(e) => setSelectedReg({
                              ...selectedReg,
                              customFieldData: { 
                                ...selectedReg.customFieldData, 
                                [field.id]: field.type === 'number' ? Number(e.target.value) : e.target.value 
                              }
                            })}
                          />
                        )}
                      </Grid>
                    ))}
                  </Grid>
                </Grid>
              )}

              <Grid size={{ xs: 12 }}>
                <Divider sx={{ my: 1 }} />
                <TextField
                  fullWidth
                  label="Reason for changes (sent to user)"
                  multiline
                  rows={3}
                  value={selectedReg.notes || ''}
                  onChange={(e) => setSelectedReg({...selectedReg, notes: e.target.value})}
                  placeholder="Explain why these changes were made (e.g., 'As discussed, we've upgraded your badge tier')."
                  helperText="This message will be included in the notification email sent to the user."
                  sx={{ mt: 2 }}
                />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button 
            variant="contained" 
            onClick={(e) => void handleEditSubmit(e)}
            disabled={eventLoading}
          >
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      {/* History Dialog */}
      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Audit History: Ticket #{selectedReg?.ticketId}</DialogTitle>
        <DialogContent dividers>
          {historyLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Stack spacing={2}>
              {historyItems.map((item) => (
                <Paper key={item.id} variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" justifyContent="space-between" mb={1}>
                    <Typography variant="subtitle2" fontWeight="bold">
                      {item.action} by {item.changedBy?.user.name || item.changedBy?.user.email || 'System'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(item.createdAt).toLocaleString()}
                    </Typography>
                  </Stack>
                  
                  {item.notes && (
                    <Typography variant="body2" sx={{ fontStyle: 'italic', mb: 1, color: 'primary.main' }}>
                      &quot;{item.notes}&quot;
                    </Typography>
                  )}

                  <Box sx={{ bgcolor: 'grey.50', p: 1, borderRadius: 1 }}>
                    {item.changes.map((change) => (
                      <Grid container key={`${change.label}:${change.old}:${change.new}`} spacing={1} sx={{ py: 0.5 }}>
                        <Grid size={{ xs: 4 }}>
                          <Typography variant="caption" fontWeight="bold">{change.label}:</Typography>
                        </Grid>
                        <Grid size={{ xs: 8 }}>
                          <Typography variant="caption">
                            <span style={{ color: 'red', textDecoration: 'line-through' }}>{change.old}</span>
                            {' → '}
                            <span style={{ color: 'green', fontWeight: 'bold' }}>{change.new}</span>
                          </Typography>
                        </Grid>
                      </Grid>
                    ))}
                  </Box>
                </Paper>
              ))}
              {historyItems.length === 0 && (
                <Typography color="text.secondary" textAlign="center">No history recorded for this registration.</Typography>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Payment Details Dialog */}
      <Dialog open={paymentDialogOpen} onClose={() => setPaymentDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Payment Details: #{selectedReg?.payments[0]?.id.slice(-8)}</DialogTitle>
        <DialogContent dividers>
          {selectedReg?.payments[0] && (
            <Stack spacing={3}>
              <Box sx={{ textAlign: 'center', mb: 2 }}>
                <Typography variant="h5" color="primary" fontWeight="bold">INVOICE</Typography>
                <Typography variant="caption" color="text.secondary">Ventry Event Management</Typography>
              </Box>

              <Grid container spacing={2}>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary" display="block">BILL TO:</Typography>
                  <Typography variant="body2" fontWeight="bold">{selectedReg.user.name || 'Attendee'}</Typography>
                  <Typography variant="caption" display="block">{selectedReg.user.email}</Typography>
                </Grid>
                <Grid size={{ xs: 6 }} sx={{ textAlign: 'right' }}>
                  <Typography variant="caption" color="text.secondary" display="block">DATE:</Typography>
                  <Typography variant="body2">{new Date(selectedReg.payments[0].createdAt).toLocaleDateString()}</Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>STATUS:</Typography>
                  <Chip label={selectedReg.payments[0].paymentStatus} size="small" color={selectedReg.payments[0].paymentStatus === 'COMPLETED' ? 'success' : 'warning'} />
                </Grid>
              </Grid>

              <Divider />

              <Box>
                <Stack direction="row" justifyContent="space-between" mb={1}>
                  <Typography variant="body2">Registration: {selectedReg.event.name}</Typography>
                  <Typography variant="body2" fontWeight="bold">{selectedReg.payments[0].amount}€</Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Method: {selectedReg.payments[0].paymentProvider || 'Stripe'}
                </Typography>
              </Box>

              <Divider sx={{ borderStyle: 'dashed' }} />

              <Stack direction="row" justifyContent="space-between">
                <Typography variant="h6">Total</Typography>
                <Typography variant="h6" color="primary.main">{selectedReg.payments[0].amount}€</Typography>
              </Stack>

              <Alert severity="info" icon={<Receipt />} sx={{ mt: 2 }}>
                This is a system-generated summary of your transaction.
              </Alert>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentDialogOpen(false)}>Close</Button>
          <Button startIcon={<Print />} variant="contained" onClick={handlePrintInvoice}>
            Print Invoice
          </Button>
        </DialogActions>
      </Dialog>

      {/* Approval Warning Dialog */}
      <Dialog open={!!statusConfirmation} onClose={() => setStatusConfirmation(null)}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HistoryIcon color="warning" />
          Confirm Approval
        </DialogTitle>
        <DialogContent>
          <Typography>
            This user <strong>has not completed their payment yet</strong>. 
            Are you sure you want to approve this registration?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Approving will notify the user that their spot is secured, despite the missing payment.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusConfirmation(null)}>Cancel</Button>
          <Button 
            variant="contained" 
            color="warning" 
            onClick={() => statusConfirmation && void handleUpdateStatus(statusConfirmation.id, statusConfirmation.status, true)}
          >
            Yes, Approve Anyway
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
