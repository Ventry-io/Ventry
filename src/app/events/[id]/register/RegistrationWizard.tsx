"use client";

import { useEffect, useState } from 'react';
import { findHotelByRoomProductId, resolveAccommodationHotels, resolveStayFee } from '@/lib/events/accommodation';
import {
  Box,
  Stepper,
  Step,
  StepLabel,
  Button,
  Typography,
  RadioGroup,
  FormControlLabel,
  Radio,
  Stack,
  Paper,
  Divider,
  Alert,
  Checkbox,
  CircularProgress,
  Grid,
  TextField,
  MenuItem
} from '@mui/material';
import { useRouter } from 'next/navigation';
import type { SerializedProduct, SerializedStayPolicy } from '@/types/event';
import { Elements } from '@stripe/react-stripe-js';
import { stripePromise } from '@/lib/stripeClient';
import PaymentForm from '@/components/events/registration/PaymentForm';

type EditMode = 'create' | 'full' | 'extras';

interface CustomField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  required: boolean;
  options?: string[];
}

interface RegistrationWizardProps {
  event: {
    id: number;
    name: string;
    products: SerializedProduct[];
    stayPolicy: SerializedStayPolicy | null;
    requiresHotel?: boolean;
    requireApproval?: boolean;
    customFields: CustomField[];
  };
  userId: string;
  editMode?: EditMode;
  initialRegistration?: {
    id: string;
    preferences: {
      productId?: string;
      productIds?: string[];
      accommodationId?: string;
      needsHotel?: boolean;
      earlyArrival?: boolean;
      lateDeparture?: boolean;
      customFieldsData?: Record<string, string | number | boolean>;
      showOnAttendees?: boolean;
    };
    status: string;
    registrationItems: Array<{
      productId: string;
      product: SerializedProduct;
    }>;
    payments: Array<{
      id: string;
      amount: number;
      paymentStatus: string;
    }>;
  };
}

function uniqueIds(ids: Array<string | undefined | null>) {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

function normalizeId(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return '';
}

export default function RegistrationWizard({
  event,
  userId,
  editMode = 'create',
  initialRegistration,
}: RegistrationWizardProps) {
  const ticketProducts = event.products.filter(product => product.type === 'TICKET');
  const existingItems = initialRegistration?.registrationItems || [];
  const lockedCoreIds = uniqueIds(
    existingItems
      .filter(item => item.product.type !== 'ADDON')
      .map(item => normalizeId(item.productId)),
  );
  const ticketCandidateIds = [
    ...lockedCoreIds,
    ...(initialRegistration?.preferences?.productIds || []).map(id => normalizeId(id)),
    normalizeId(initialRegistration?.preferences?.productId),
  ];
  const existingTicketId = ticketCandidateIds.find(id => ticketProducts.some(product => product.id === id)) || '';
  const existingAccommodationId =
    normalizeId(existingItems.find(item => item.product.type === 'ACCOMMODATION')?.productId) ||
    normalizeId(initialRegistration?.preferences?.accommodationId) ||
    '';
  const lockedAddonIds = existingItems
    .filter(item => item.product.type === 'ADDON')
    .map(item => normalizeId(item.productId))
    .filter(Boolean);
  const fallbackAddonIds = (initialRegistration?.preferences?.productIds || []).filter(
    id => id !== existingTicketId && id !== existingAccommodationId && !lockedAddonIds.includes(id),
  );
  const initialAddonIds = uniqueIds([...lockedAddonIds, ...fallbackAddonIds]);
  const defaultCreateTicketId = ticketProducts[0]?.id || '';

  const [activeStep, setActiveStep] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState<string>(existingTicketId || (editMode === 'create' ? defaultCreateTicketId : ''));
  const [selectedAccommodationId, setSelectedAccommodationId] = useState<string>(existingAccommodationId);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>(initialAddonIds);
  const [needsHotel, setNeedsHotel] = useState(
    event.requiresHotel || Boolean(existingAccommodationId) || initialRegistration?.preferences?.needsHotel || false,
  );
  const [earlyArrival, setEarlyArrival] = useState(initialRegistration?.preferences?.earlyArrival || false);
  const [lateDeparture, setLateDeparture] = useState(initialRegistration?.preferences?.lateDeparture || false);
  const [showOnAttendees, setShowOnAttendees] = useState(initialRegistration?.preferences?.showOnAttendees || false);
  const [customFieldsData, setCustomFieldsData] = useState<Record<string, string | number | boolean>>(
    initialRegistration?.preferences?.customFieldsData || {},
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const router = useRouter();
  const isEditing = editMode !== 'create';
  const isExtrasOnlyMode = editMode === 'extras';
  const canEditCoreSelection = !isExtrasOnlyMode;
  const canEditStaySelection = !isExtrasOnlyMode;
  const isApprovalSatisfied = !event.requireApproval || ['APPROVED', 'CONFIRMED'].includes(initialRegistration?.status || '');
  const canProceedToPayment = isApprovalSatisfied;
  const accommodationHotels = resolveAccommodationHotels(event.stayPolicy, event.products, event.name);
  const selectedHotel = findHotelByRoomProductId(event.stayPolicy, selectedAccommodationId, event.products, event.name);
  const selectedRoom = event.products.find(p => p.id === selectedAccommodationId);
  const selectedProduct = event.products.find(p => p.id === selectedProductId);
  const newlySelectedAddonIds = selectedAddonIds.filter(id => !lockedAddonIds.includes(id));

  /* eslint-disable react-hooks/set-state-in-effect -- intentional derived state reset when hotel selection changes */
  useEffect(() => {
    if (!selectedHotel) {
      setEarlyArrival(false);
      setLateDeparture(false);
      return;
    }

    if (!selectedHotel.stayPolicy.earlyArrival.enabled) {
      setEarlyArrival(false);
    }

    if (!selectedHotel.stayPolicy.lateDeparture.enabled) {
      setLateDeparture(false);
    }
  }, [selectedHotel]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const baseSteps = ['Choose Badge'];
  const hasAddons = event.products.some(p => p.type === 'ADDON');
  if (hasAddons) {
    baseSteps.push('Addons');
  }
  baseSteps.push('Stay Preferences');
  if (event.customFields?.length > 0) {
    baseSteps.push('Additional Info');
  }
  const steps = [...baseSteps, 'Confirm', ...(canProceedToPayment ? ['Payment'] : [])];

  const handleNext = () => {
    if (steps[activeStep] === 'Choose Badge' && canEditCoreSelection && !selectedProductId) {
      setError('Please select a badge type');
      return;
    }

    if (steps[activeStep] === 'Stay Preferences') {
      if (needsHotel && accommodationHotels.length > 0 && !selectedAccommodationId) {
        setError('Please select a room type');
        return;
      }
    }

    if (steps[activeStep] === 'Additional Info') {
      const missingRequired = event.customFields.find(
        field => field.required && !customFieldsData[field.id] && customFieldsData[field.id] !== 0,
      );
      if (missingRequired) {
        setError(`"${missingRequired.label}" is required`);
        return;
      }
    }

    setError(null);
    setActiveStep(prev => prev + 1);
  };

  const handleBack = () => {
    setActiveStep(prev => prev - 1);
  };

  const buildSelectedProductIds = () => {
    if (isExtrasOnlyMode) {
      return uniqueIds([...lockedCoreIds, ...selectedAddonIds]);
    }

    return uniqueIds([selectedProductId, ...selectedAddonIds, selectedAccommodationId]);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      const payload = {
        userId,
        mode: editMode,
        productId: canEditCoreSelection ? selectedProductId : existingTicketId,
        productIds: buildSelectedProductIds(),
        preferences: {
          productId: (canEditCoreSelection ? selectedProductId : existingTicketId) || undefined,
          needsHotel,
          earlyArrival,
          lateDeparture,
          customFieldsData,
          showOnAttendees,
          accommodationId: selectedAccommodationId || undefined,
        },
      };

      if (isEditing) {
        const response = await fetch(`/api/event/${event.id}/update`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Update failed');
        }

        if (!data.paymentId) {
          const message = data.awaitingApproval ? 'approval_pending' : 'update_success';
          router.push(`/events/${event.id}?message=${message}`);
          return;
        }

        const intentResponse = await fetch('/api/payment/create-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId: data.paymentId }),
        });

        if (!intentResponse.ok) {
          throw new Error('Failed to initialize payment');
        }

        const { clientSecret: nextClientSecret } = await intentResponse.json();
        setClientSecret(nextClientSecret);
        setActiveStep(prev => prev + 1);
        return;
      }

      const response = await fetch(`/api/event/${event.id}/attend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }

      if (!data.paymentId) {
        router.push(data.awaitingApproval ? '/profile?message=approval_pending' : '/profile?message=registration_success');
        return;
      }

      const intentResponse = await fetch('/api/payment/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: data.paymentId }),
      });

      if (!intentResponse.ok) {
        throw new Error('Failed to initialize payment');
      }

      const { clientSecret: nextClientSecret } = await intentResponse.json();
      setClientSecret(nextClientSecret);
      setActiveStep(prev => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentSuccess = () => {
    if (isEditing) {
      router.push(`/events/${event.id}?message=update_success`);
      return;
    }

    router.push('/profile?message=registration_success');
  };

  const calculateTotal = () => {
    if (isExtrasOnlyMode) {
      return event.products
        .filter(product => newlySelectedAddonIds.includes(product.id))
        .reduce((sum, addon) => sum + addon.price, 0);
    }

    let total = selectedProduct?.price || 0;
    const addons = event.products.filter(product => selectedAddonIds.includes(product.id));
    addons.forEach(addon => {
      total += addon.price;
    });

    if (needsHotel && selectedRoom) {
      total += selectedRoom.price;
    }

    if (earlyArrival && selectedHotel) {
      total += resolveStayFee(selectedHotel.stayPolicy.earlyArrival, selectedRoom?.price || 0);
    }

    if (lateDeparture && selectedHotel) {
      total += resolveStayFee(selectedHotel.stayPolicy.lateDeparture, selectedRoom?.price || 0);
    }

    return total;
  };

  const totalAmount = calculateTotal();
  const totalLabel = isExtrasOnlyMode ? 'Amount Due Now' : 'Total Amount';

  const formatDate = (dateValue: string | Date | undefined) => {
    if (!dateValue) return '';
    try {
      return new Date(dateValue).toLocaleDateString(undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch (_error) {
      return String(dateValue);
    }
  };

  return (
    <Grid container spacing={4} alignItems="stretch">
      <Grid size={{ xs: 12, md: 8 }}>
        <Paper
          elevation={3}
          sx={{
            p: { xs: 3, md: 6 },
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 600,
          }}
        >
          <Box sx={{ width: '100%', flexGrow: 1 }}>
            <Stepper activeStep={activeStep} sx={{ mb: 6 }}>
              {steps.map(label => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>

            {error && <Alert severity="error" sx={{ mb: 4 }}>{error}</Alert>}
            {isExtrasOnlyMode && (
              <Alert severity="info" sx={{ mb: 4 }}>
                Paid registrations can add new extras and update profile details here. Ticket and hotel changes require organizer support.
              </Alert>
            )}

            {steps[activeStep] === 'Choose Badge' && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  {isExtrasOnlyMode ? 'Your badge tier' : 'Select your badge tier'}
                </Typography>
                {isExtrasOnlyMode && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Badge changes are locked after payment.
                  </Typography>
                )}
                <RadioGroup
                  value={selectedProductId}
                  onChange={event => {
                    if (canEditCoreSelection) {
                      setSelectedProductId(event.target.value);
                    }
                  }}
                >
                  <Stack spacing={2}>
                    {ticketProducts.map(product => (
                      <Paper
                        key={product.id}
                        variant="outlined"
                        sx={{
                          p: 3,
                          cursor: canEditCoreSelection ? 'pointer' : 'default',
                          borderColor: selectedProductId === product.id ? 'primary.main' : 'divider',
                          bgcolor: selectedProductId === product.id ? 'primary.50' : 'background.paper',
                          '&:hover': canEditCoreSelection ? { borderColor: 'primary.light' } : undefined,
                        }}
                        onClick={() => {
                          if (canEditCoreSelection) {
                            setSelectedProductId(product.id);
                          }
                        }}
                      >
                        <FormControlLabel
                          value={product.id}
                          control={<Radio disabled={!canEditCoreSelection} />}
                          label={
                            <Box>
                              <Typography variant="h6">{product.name} - {product.price}€</Typography>
                              {product.description && (
                                <Typography variant="body2" color="text.secondary">{product.description}</Typography>
                              )}
                            </Box>
                          }
                          sx={{ width: '100%', m: 0 }}
                        />
                      </Paper>
                    ))}
                    {ticketProducts.length === 0 && (
                      <Alert severity="warning">
                        No ticket products are configured for this event.
                      </Alert>
                    )}
                  </Stack>
                </RadioGroup>
              </Box>
            )}

            {steps[activeStep] === 'Addons' && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  {isExtrasOnlyMode ? 'Add More Extras' : 'Additional Items'}
                </Typography>
                {event.products.filter(product => product.type === 'ADDON').length === 0 ? (
                  <Typography color="text.secondary">No addons available for this event.</Typography>
                ) : (
                  <Stack spacing={2}>
                    {event.products.filter(product => product.type === 'ADDON').map(product => {
                      const isLockedAddon = lockedAddonIds.includes(product.id);
                      const isSelected = selectedAddonIds.includes(product.id);

                      return (
                        <Paper
                          key={product.id}
                          variant="outlined"
                          sx={{
                            p: 3,
                            borderColor: isSelected ? 'primary.main' : 'divider',
                            bgcolor: isSelected ? 'primary.50' : 'background.paper',
                          }}
                        >
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={isSelected}
                                disabled={isLockedAddon}
                                onChange={event => {
                                  if (isLockedAddon) {
                                    return;
                                  }

                                  if (event.target.checked) {
                                    setSelectedAddonIds(prev => uniqueIds([...prev, product.id]));
                                  } else {
                                    setSelectedAddonIds(prev => prev.filter(id => id !== product.id));
                                  }
                                }}
                              />
                            }
                            label={
                              <Box ml={1}>
                                <Typography variant="h6">
                                  {product.name} - {product.price}€
                                  {isLockedAddon ? ' (already added)' : ''}
                                </Typography>
                                {product.description && (
                                  <Typography variant="body2" color="text.secondary">{product.description}</Typography>
                                )}
                              </Box>
                            }
                            sx={{ width: '100%', m: 0, alignItems: 'flex-start' }}
                          />
                        </Paper>
                      );
                    })}
                  </Stack>
                )}
              </Box>
            )}

            {steps[activeStep] === 'Stay Preferences' && (
              <Box>
                <Typography variant="h6" gutterBottom>Accommodation</Typography>
                <Stack spacing={3}>
                  <Paper variant="outlined" sx={{ p: 3 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={needsHotel}
                          disabled={event.requiresHotel || !canEditStaySelection}
                          onChange={changeEvent => {
                            if (!canEditStaySelection) {
                              return;
                            }

                            if (event.requiresHotel) {
                              return;
                            }

                            setNeedsHotel(changeEvent.target.checked);
                            if (!changeEvent.target.checked) {
                              setSelectedAccommodationId('');
                              setEarlyArrival(false);
                              setLateDeparture(false);
                            }
                          }}
                        />
                      }
                      label={
                        isExtrasOnlyMode
                          ? 'Hotel selection is locked after payment'
                          : event.requiresHotel
                            ? 'A hotel selection is required for this event'
                            : 'I will be staying at one of the event hotels'
                      }
                    />

                    {needsHotel && accommodationHotels.length > 0 && (
                      <Box sx={{ mt: 3, pl: 4 }}>
                        <Typography variant="subtitle2" gutterBottom>Select Hotel & Room Type</Typography>
                        <RadioGroup
                          value={selectedAccommodationId}
                          onChange={event => {
                            if (canEditStaySelection) {
                              setSelectedAccommodationId(event.target.value);
                            }
                          }}
                        >
                          <Stack spacing={2}>
                            {accommodationHotels.map(hotel => (
                              <Paper key={hotel.id} variant="outlined" sx={{ p: 2 }}>
                                <Typography variant="subtitle1" gutterBottom>{hotel.name}</Typography>
                                <Stack spacing={1}>
                                  {hotel.roomTypes.map(room => (
                                    <FormControlLabel
                                      key={room.id}
                                      value={room.id}
                                      control={<Radio disabled={!canEditStaySelection} />}
                                      label={`${room.name} (${room.price}€)${room.description ? ` - ${room.description}` : ''}`}
                                    />
                                  ))}
                                </Stack>
                              </Paper>
                            ))}
                          </Stack>
                        </RadioGroup>
                      </Box>
                    )}

                    {needsHotel && (
                      <Box sx={{ mt: 2, pl: 4 }}>
                        {!selectedAccommodationId && accommodationHotels.length > 0 && (
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            Choose a room first to see the hotel&apos;s early and late stay options.
                          </Typography>
                        )}
                        {selectedHotel?.stayPolicy.earlyArrival.enabled && (
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={earlyArrival}
                                disabled={!canEditStaySelection}
                                onChange={event => setEarlyArrival(event.target.checked)}
                              />
                            }
                            label={
                              <Typography>
                                Request Early Arrival (from {formatDate(selectedHotel.stayPolicy.earlyArrival.from as unknown as string)})
                                {` - +${resolveStayFee(selectedHotel.stayPolicy.earlyArrival, selectedRoom?.price || 0)}€`}
                              </Typography>
                            }
                          />
                        )}
                        {selectedHotel?.stayPolicy.lateDeparture.enabled && (
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={lateDeparture}
                                disabled={!canEditStaySelection}
                                onChange={event => setLateDeparture(event.target.checked)}
                              />
                            }
                            label={
                              <Typography>
                                Request Late Departure (until {formatDate(selectedHotel.stayPolicy.lateDeparture.until as unknown as string)})
                                {` - +${resolveStayFee(selectedHotel.stayPolicy.lateDeparture, selectedRoom?.price || 0)}€`}
                              </Typography>
                            }
                          />
                        )}
                      </Box>
                    )}
                  </Paper>

                  <Paper variant="outlined" sx={{ p: 3 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={showOnAttendees}
                          onChange={event => setShowOnAttendees(event.target.checked)}
                        />
                      }
                      label="Show my name on the attendees page"
                    />
                    <Typography variant="body2" color="text.secondary" sx={{ pl: 4 }}>
                      If unchecked, you will appear as &quot;Anonymous&quot;.
                    </Typography>
                  </Paper>
                </Stack>
              </Box>
            )}

            {steps[activeStep] === 'Additional Info' && (
              <Box>
                <Typography variant="h6" gutterBottom>Additional Questions</Typography>
                <Stack spacing={3}>
                  {event.customFields.map(field => (
                    <Box key={field.id}>
                      {field.type === 'boolean' ? (
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={!!customFieldsData[field.id]}
                              onChange={event =>
                                setCustomFieldsData(prev => ({ ...prev, [field.id]: event.target.checked }))
                              }
                            />
                          }
                          label={`${field.label}${field.required ? ' *' : ''}`}
                        />
                      ) : field.type === 'select' ? (
                        <TextField
                          fullWidth
                          select
                          label={field.label}
                          required={field.required}
                          value={customFieldsData[field.id] || ''}
                          onChange={event =>
                            setCustomFieldsData(prev => ({ ...prev, [field.id]: event.target.value }))
                          }
                        >
                          {field.options?.map(option => (
                            <MenuItem key={option} value={option}>
                              {option}
                            </MenuItem>
                          ))}
                        </TextField>
                      ) : (
                        <TextField
                          fullWidth
                          label={field.label}
                          type={field.type === 'number' ? 'number' : 'text'}
                          required={field.required}
                          value={customFieldsData[field.id] || ''}
                          onChange={event =>
                            setCustomFieldsData(prev => ({
                              ...prev,
                              [field.id]: field.type === 'number' ? Number(event.target.value) : event.target.value,
                            }))
                          }
                        />
                      )}
                    </Box>
                  ))}
                </Stack>
              </Box>
            )}

            {steps[activeStep] === 'Confirm' && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  {isEditing ? 'Review your changes' : 'Review your registration'}
                </Typography>
                <Box sx={{ mb: 4 }}>
                  <Stack spacing={2}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">Badge Type:</Typography>
                      <Typography fontWeight="bold">
                        {selectedProduct?.name}
                        {isExtrasOnlyMode ? ' (locked)' : ''}
                      </Typography>
                    </Box>
                    {event.products.filter(product => selectedAddonIds.includes(product.id)).map(addon => (
                      <Box key={addon.id} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">Addon:</Typography>
                        <Typography>
                          {addon.name}
                          {lockedAddonIds.includes(addon.id) ? ' (already added)' : ''}
                        </Typography>
                      </Box>
                    ))}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">Hotel Stay:</Typography>
                      <Typography>{needsHotel ? 'Yes' : 'No'}</Typography>
                    </Box>
                    {needsHotel && selectedAccommodationId && (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">Hotel / Room:</Typography>
                        <Typography>
                          {selectedHotel?.name} / {event.products.find(product => product.id === selectedAccommodationId)?.name}
                          {isExtrasOnlyMode ? ' (locked)' : ''}
                        </Typography>
                      </Box>
                    )}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography color="text.secondary">Attendee List:</Typography>
                      <Typography>{showOnAttendees ? 'Show my name' : 'Anonymous'}</Typography>
                    </Box>
                    {event.customFields.map(field => (
                      <Box key={field.id} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Typography color="text.secondary">{field.label}:</Typography>
                        <Typography>
                          {field.type === 'boolean'
                            ? (customFieldsData[field.id] ? 'Yes' : 'No')
                            : String(customFieldsData[field.id] || '-')}
                        </Typography>
                      </Box>
                    ))}
                    <Divider />
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="h5">{totalLabel}:</Typography>
                      <Typography variant="h5" fontWeight="bold" color="primary">{totalAmount}€</Typography>
                    </Box>
                  </Stack>
                </Box>
                <Alert severity="info">
                  {isExtrasOnlyMode
                    ? 'Only newly added extras will create an additional payment.'
                    : !canProceedToPayment
                      ? 'Registration will be submitted for approval. Payment will unlock after an admin approves it.'
                      : 'Payment will be handled at the event or via bank transfer instructions sent to your email.'}
                </Alert>
              </Box>
            )}

            {steps[activeStep] === 'Payment' && clientSecret && (
              <Box>
                <Typography variant="h6" gutterBottom>Complete Payment</Typography>
                <Elements stripe={stripePromise} options={{ clientSecret }}>
                  <PaymentForm onSuccess={handlePaymentSuccess} />
                </Elements>
              </Box>
            )}
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 6, gap: 2 }}>
            {steps[activeStep] !== 'Payment' && (
              <Button disabled={activeStep === 0 || loading} onClick={handleBack}>
                Back
              </Button>
            )}
            {steps[activeStep] === 'Confirm' ? (
              <Button
                variant="contained"
                onClick={() => void handleSubmit()}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
              >
                {loading
                  ? 'Processing...'
                  : totalAmount > 0
                    ? canProceedToPayment
                      ? 'Proceed to Payment'
                      : 'Submit for Approval'
                    : 'Save Changes'}
              </Button>
            ) : activeStep < steps.length - 1 && steps[activeStep] !== 'Payment' ? (
              <Button variant="contained" onClick={handleNext}>
                Next
              </Button>
            ) : null}
          </Box>
        </Paper>
      </Grid>

      <Grid size={{ xs: 12, md: 4 }}>
        <Paper
          elevation={3}
          sx={{
            p: 4,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Typography variant="h6" gutterBottom fontWeight="bold">Summary</Typography>
          <Divider sx={{ mb: 3 }} />

          <Stack spacing={2} sx={{ flexGrow: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="body1" color="text.secondary">
                {selectedProduct ? selectedProduct.name : 'Badge Selection'}
              </Typography>
              <Typography variant="body1" fontWeight="bold">
                {isExtrasOnlyMode ? 'Already paid' : selectedProduct ? `${selectedProduct.price}€` : '-'}
              </Typography>
            </Box>

            {selectedAddonIds.length > 0 && event.products
              .filter(product => selectedAddonIds.includes(product.id))
              .map(addon => (
                <Box key={addon.id} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">{addon.name}</Typography>
                  <Typography variant="body2" fontWeight="medium">
                    {lockedAddonIds.includes(addon.id) ? 'Already added' : `+${addon.price}€`}
                  </Typography>
                </Box>
              ))}

            {needsHotel && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  {selectedAccommodationId && Math.max(0, event.products.find(product => product.id === selectedAccommodationId)?.price || 0) > 0
                    ? `${selectedHotel?.name}: ${event.products.find(product => product.id === selectedAccommodationId)?.name}`
                    : 'Hotel Stay'}
                </Typography>
                <Typography variant="body2" fontWeight="medium">
                  {isExtrasOnlyMode
                    ? 'Locked'
                    : selectedAccommodationId && Math.max(0, event.products.find(product => product.id === selectedAccommodationId)?.price || 0) > 0
                      ? `+${event.products.find(product => product.id === selectedAccommodationId)?.price}€`
                      : 'Included'}
                </Typography>
              </Box>
            )}

            {!isExtrasOnlyMode && earlyArrival && selectedHotel && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">Early Arrival Fee</Typography>
                <Typography variant="body2" fontWeight="medium">
                  +{resolveStayFee(selectedHotel.stayPolicy.earlyArrival, selectedRoom?.price || 0)}€
                </Typography>
              </Box>
            )}

            {!isExtrasOnlyMode && lateDeparture && selectedHotel && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">Late Departure Fee</Typography>
                <Typography variant="body2" fontWeight="medium">
                  +{resolveStayFee(selectedHotel.stayPolicy.lateDeparture, selectedRoom?.price || 0)}€
                </Typography>
              </Box>
            )}
          </Stack>

          <Box sx={{ mt: 'auto' }}>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6" fontWeight="bold">
                {isExtrasOnlyMode ? 'Due Now' : 'Total'}
              </Typography>
              <Typography variant="h4" color="primary.main" fontWeight="bold">{totalAmount}€</Typography>
            </Box>
          </Box>
        </Paper>
      </Grid>
    </Grid>
  );
}
