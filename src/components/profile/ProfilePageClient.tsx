"use client";

import { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  MenuItem,
  Stack,
  Chip,
  Card,
  CardContent,
  CardActions,
  InputAdornment,
  Link,
  Tabs,
  Tab,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Save,
  Delete,
  Download,
  Visibility,
  VisibilityOff,
  Telegram,
  Twitter,
  PhotoCamera,
  ExpandMore,
  Badge,
  Public,
} from '@mui/icons-material';
import ProfilePictureGallery from './ProfilePictureGallery';
import LinkedAccounts from './LinkedAccounts';
import MyRegistrations from './MyRegistrations';
import { normalizeCountryCode } from '@/lib/countries';
import { DISPLAY_NAME_MAX_LENGTH } from '@/lib/user/display-name';
import CountryAutocomplete from '@/components/common/CountryAutocomplete';
import { calculateRealisticAge, getBirthDateBounds } from '@/lib/user/birthdate';
import { diffPayload } from '@/lib/diffPayload';
import authClient from '@/lib/auth/client';
import { notifyProfilePictureChanged } from '@/lib/user/profilePictureEvents';
import { hasCheckInIdentity, hasBillingAddress } from '@/lib/user/profile-completion';

interface ProfilePicture {
  id: string;
  signedUrl?: string | null;
  storagePath?: string | null;
  isPrimary: boolean;
  createdAt: Date;
}

interface SocialLinks {
  telegram?: string;
  twitter?: string;
  instagram?: string;
}

interface ProfileUpdatePayload {
  name: string;
  country: string | null;
  legalName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
  bio: string;
  dateOfBirth: string | undefined;
  pronouns: string;
  showAge: boolean;
  showExactBirthdate: boolean;
  showConventions: boolean;
  socialLinks: SocialLinks;
  [key: string]: unknown;
}

interface User {
  id: string;
  name?: string | null;
  username?: string | null;
  email: string;
  emailVerified?: boolean;
  country?: string | null;
  legalName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressPostalCode?: string | null;
  addressCountry?: string | null;
  profilePictures: ProfilePicture[];
  accounts: Array<{
    id: string;
    accountId: string;
    providerId: string;
    password?: string | null;
  }>;
  bio?: string | null;
  dateOfBirth?: Date | null;
  pronouns?: string | null;
  showAge: boolean;
  showExactBirthdate: boolean;
  showConventions?: boolean;
  socialLinks?: SocialLinks | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ProfilePageClientProps {
  user: User;
  isOrganization?: boolean;
  isOrganizer?: boolean;
}

interface ProfileFormData {
  name: string;
  username: string;
  country: string;
  legalName: string;
  addressLine1: string;
  addressLine2: string;
  addressCity: string;
  addressState: string;
  addressPostalCode: string;
  addressCountry: string;
  bio: string;
  dateOfBirth: string;
  pronouns: string;
  showAge: boolean;
  showExactBirthdate: boolean;
  showConventions: boolean;
  customPronouns?: string;
  socialLinks: {
    telegram: string;
    twitter: string;
    instagram: string;
  };
}

const PROFILE_TABS = [
  { value: 'general', label: 'General' },
  { value: 'personal', label: 'Personal information' },
  { value: 'socials', label: 'Socials' },
  { value: 'auth', label: 'Authentication' },
  { value: 'advanced', label: 'Advanced' },
];

const PRONOUN_OPTIONS = [
  'she/her',
  'he/him',
  'they/them',
  'she/they',
  'he/they',
  'any pronouns',
  'ask me',
  'prefer not to say',
  'choose my own pronouns'
];

const FIELD_LABELS: Record<string, string> = {
  name: 'Display name',
  username: 'Username',
  legalName: 'Legal name',
  addressLine1: 'Address',
  addressLine2: 'Address line 2',
  addressCity: 'City',
  addressState: 'State/Region',
  addressPostalCode: 'Postal code',
  country: 'Country',
  addressCountry: 'Address country',
  bio: 'Bio',
  dateOfBirth: 'Date of birth',
  pronouns: 'Pronouns',
  socialLinks: 'Social links',
};

// Server validation errors come back as a zod tree: { properties: { field: { errors: [...] } } }.
// Without this, a rejected save just says "Failed to update profile" with no clue which field broke.
function extractApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const { error } = payload as { error?: unknown };
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return null;

  const properties = (error as { properties?: Record<string, { errors?: string[] }> }).properties;
  if (properties) {
    for (const [field, detail] of Object.entries(properties)) {
      const message = detail?.errors?.[0];
      if (message) {
        return `${FIELD_LABELS[field] || field}: ${message}`;
      }
    }
  }

  const topLevelErrors = (error as { errors?: string[] }).errors;
  return topLevelErrors?.[0] ?? null;
}

function renderSocialLink(baseUrl: string, username: string) {
  const handle = username.trim().replace(/^@/, '');
  if (!handle) return `${baseUrl}username`;
  const url = `${baseUrl}${encodeURIComponent(handle)}`;
  return <Link href={url} target="_blank" rel="noopener noreferrer" sx={{ overflowWrap: 'anywhere' }}>{url}</Link>;
}

const sectionSx = {
  p: { xs: 2, md: 2.5 },
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1,
  bgcolor: 'background.paper',
};

export default function ProfilePageClient({ user, isOrganization = false, isOrganizer = false }: ProfilePageClientProps) {
  const [readiness, setReadiness] = useState(() => ({ checkIn: hasCheckInIdentity(user), billing: hasBillingAddress(user) }));
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [activeTab, setActiveTab] = useState('general');
  const [newEmail, setNewEmail] = useState('');
  const [changingEmail, setChangingEmail] = useState(false);
  const [emailRequested, setEmailRequested] = useState(false);
  const socialLinks = (user.socialLinks as SocialLinks | null | undefined) ?? {};
  const [formData, setFormData] = useState<ProfileFormData>({
    name: user.name || '',
    username: user.username || '',
    country: normalizeCountryCode(user.country) || '',
    legalName: user.legalName || '',
    addressLine1: user.addressLine1 || '',
    addressLine2: user.addressLine2 || '',
    addressCity: user.addressCity || '',
    addressState: user.addressState || '',
    addressPostalCode: user.addressPostalCode || '',
    addressCountry: normalizeCountryCode(user.addressCountry) || '',
    bio: user.bio || '',
    dateOfBirth: calculateRealisticAge(user.dateOfBirth) !== null && user.dateOfBirth
      ? new Date(user.dateOfBirth).toISOString().split('T')[0]
      : '',
    pronouns: user.pronouns || '',
    showAge: user.showAge ?? true,
    showExactBirthdate: user.showExactBirthdate ?? false,
    showConventions: user.showConventions ?? false,
    customPronouns: user.pronouns && !PRONOUN_OPTIONS.includes(user.pronouns) ? user.pronouns : undefined,
    socialLinks: {
      telegram: socialLinks.telegram || '',
      twitter: socialLinks.twitter || '',
      instagram: socialLinks.instagram || '',
    }
  });

  // Tracked separately from ProfileUpdatePayload/baselinePayloadRef: a
  // username change has side effects (uniqueness + 90-day reservation of the
  // old handle) that go through their own dedicated endpoint, not the
  // generic diffed profile PATCH.
  const usernameBaselineRef = useRef(user.username || '');

  const baselinePayloadRef = useRef<ProfileUpdatePayload>({
    name: user.name || '',
    country: normalizeCountryCode(user.country) || null,
    legalName: user.legalName || null,
    addressLine1: user.addressLine1 || null,
    addressLine2: user.addressLine2 || null,
    addressCity: user.addressCity || null,
    addressState: user.addressState || null,
    addressPostalCode: user.addressPostalCode || null,
    addressCountry: normalizeCountryCode(user.addressCountry) || null,
    bio: user.bio || '',
    dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth).toISOString() : undefined,
    pronouns: user.pronouns || '',
    showAge: user.showAge ?? true,
    showExactBirthdate: user.showExactBirthdate ?? false,
    showConventions: user.showConventions ?? false,
    socialLinks: {
      ...(socialLinks.telegram && { telegram: socialLinks.telegram }),
      ...(socialLinks.twitter && { twitter: socialLinks.twitter }),
      ...(socialLinks.instagram && { instagram: socialLinks.instagram }),
    },
  });

  const [profilePictures, setProfilePictures] = useState<ProfilePicture[]>(user.profilePictures);

  const refreshProfilePictures = async () => {
    try {
      const response = await fetch(`/api/user/profile-picture?userId=${user.id}`);
      if (response.ok) {
        const data = await response.json();
        setProfilePictures(data.profilePictures || []);
        notifyProfilePictureChanged();
      }
    } catch (error) {
      console.error('Failed to refresh profile pictures:', error);
    }
  };

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [linkSuccess, setLinkSuccess] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (PROFILE_TABS.some(item => item.value === tab)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore the tab after email verification.
      setActiveTab(tab || 'general');
      if (params.has('error')) {
        setError('Email verification failed. The link may have expired. Please request the change again.');
      }
    }
    if (params.get('linked') === 'success') {
      setLinkSuccess(true);
      setActiveTab('auth');
      window.history.replaceState({}, '', '/profile');
      setTimeout(() => setLinkSuccess(false), 5000);
    }
  }, []);

  const handleInputChange = (field: keyof ProfileFormData) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.type === 'checkbox' ? (event.target as HTMLInputElement).checked : event.target.value;
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSocialChange = (platform: keyof ProfileFormData['socialLinks']) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value.replace(/^@/, '');
    setFormData(prev => ({
      ...prev,
      socialLinks: { ...prev.socialLinks, [platform]: value }
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const displayName = formData.name.trim();
    if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
      setSaving(false);
      setError(`Display name must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`);
      return;
    }

    const username = formData.username.trim();
    if (username !== usernameBaselineRef.current) {
      if (username.length < 2 || username.length > DISPLAY_NAME_MAX_LENGTH) {
        setSaving(false);
        setError(`Username must be between 2 and ${DISPLAY_NAME_MAX_LENGTH} characters.`);
        return;
      }
      if (/\s/.test(username)) {
        setSaving(false);
        setError('Username cannot contain spaces.');
        return;
      }

      try {
        const usernameResponse = await fetch('/api/user/username', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        });

        if (!usernameResponse.ok) {
          let message = 'Failed to update username.';
          try {
            const errorPayload = await usernameResponse.json();
            message = extractApiErrorMessage(errorPayload) ?? message;
          } catch {
            // response body wasn't JSON - stick with the generic message
          }
          throw new Error(message);
        }

        usernameBaselineRef.current = username;
      } catch (err) {
        setSaving(false);
        setError(err instanceof Error ? err.message : 'Failed to update username');
        return;
      }
    }

    const selectedBirthDate = formData.dateOfBirth ? new Date(formData.dateOfBirth) : null;
    const birthDateBounds = getBirthDateBounds();
    if (
      selectedBirthDate &&
      (Number.isNaN(selectedBirthDate.getTime()) || calculateRealisticAge(formData.dateOfBirth) === null)
    ) {
      setSaving(false);
      setError(`Birth date must be between ${birthDateBounds.min} and ${birthDateBounds.max}.`);
      return;
    }

    const socialLinksPayload: SocialLinks = {};
    if (formData.socialLinks.telegram) socialLinksPayload.telegram = formData.socialLinks.telegram;
    if (formData.socialLinks.twitter) socialLinksPayload.twitter = formData.socialLinks.twitter;
    if (formData.socialLinks.instagram) socialLinksPayload.instagram = formData.socialLinks.instagram;
    const pronouns = formData.pronouns === 'choose my own pronouns'
      ? formData.customPronouns?.trim() || ''
      : formData.pronouns;

    const payload: ProfileUpdatePayload = {
      name: displayName,
      country: formData.country || null,
      legalName: formData.legalName || null,
      addressLine1: formData.addressLine1 || null,
      addressLine2: formData.addressLine2 || null,
      addressCity: formData.addressCity || null,
      addressState: formData.addressState || null,
      addressPostalCode: formData.addressPostalCode || null,
      addressCountry: formData.addressCountry || null,
      bio: formData.bio,
      dateOfBirth: formData.dateOfBirth ? new Date(formData.dateOfBirth).toISOString() : undefined,
      pronouns,
      showAge: formData.showAge,
      showExactBirthdate: formData.showExactBirthdate,
      showConventions: formData.showConventions,
      socialLinks: socialLinksPayload,
    };

    const diff = diffPayload(baselinePayloadRef.current, payload);

    if (Object.keys(diff).length === 0) {
      setSaving(false);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      return;
    }

    try {
      const response = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, ...diff })
      });

      if (!response.ok) {
        let message = 'Failed to update profile.';
        try {
          const errorPayload = await response.json();
          message = extractApiErrorMessage(errorPayload) ?? message;
        } catch {
          // response body wasn't JSON - stick with the generic message
        }
        throw new Error(message);
      }

      baselinePayloadRef.current = payload;
      setReadiness({ checkIn: hasCheckInIdentity(payload), billing: hasBillingAddress(payload) });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChangeEmail = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChangingEmail(true);
    setEmailRequested(false);
    setError(null);
    try {
      const result = await authClient.changeEmail({
        newEmail: newEmail.trim(),
        callbackURL: '/profile?tab=auth',
      });
      if (result.error) {
        throw new Error(result.error.message || 'Failed to request email change. Please sign in again and retry.');
      }
      setEmailRequested(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request email change');
    } finally {
      setChangingEmail(false);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      const response = await fetch(`/api/user?userId=${user.id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete account');
      }

      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
    }
  };

  const handleDownloadData = async () => {
    try {
      const response = await fetch(`/api/user/export?userId=${user.id}`);

      if (!response.ok) {
        throw new Error('Failed to export data');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${user.name || 'user'}-data-export.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setDownloadDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export data');
    }
  };

  const birthDateBounds = getBirthDateBounds();
  const displayedAge = formData.dateOfBirth ? calculateRealisticAge(formData.dateOfBirth) : null;
  const displayNameLength = formData.name.length;
  const displayNameTooLong = displayNameLength > DISPLAY_NAME_MAX_LENGTH;
  const checkInReady = hasCheckInIdentity(formData);
  const identityReady = checkInReady && hasBillingAddress(formData);
  const hasIdentityDetails = Object.values({ name: formData.legalName, address: formData.addressLine1, city: formData.addressCity, postal: formData.addressPostalCode, country: formData.addressCountry }).some(Boolean);

  return (
    <Stack spacing={2.5}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" onClose={() => setSuccess(false)}>
          Profile updated successfully!
        </Alert>
      )}

      {linkSuccess && (
        <Alert severity="success" onClose={() => setLinkSuccess(false)}>
          Account linked successfully!
        </Alert>
      )}

      <Stack spacing={1} sx={{ pb: 1 }}>
        <Typography variant="subtitle2">Account readiness</Typography>
        <Stack direction="row" gap={1} flexWrap="wrap">
          <Chip size="small" variant="outlined" color={user.emailVerified ? "success" : "default"}
            label={user.emailVerified ? "Email verified" : "Verify email"}
            component="a" clickable href={user.emailVerified ? "/profile?tab=auth" : `/check-email?email=${encodeURIComponent(user.email)}&callbackUrl=%2Fprofile`} />
          <Chip size="small" variant="outlined" color={readiness.checkIn ? "success" : "default"}
            label={readiness.checkIn ? "Check-in ready" : "Add check-in name"}
            onClick={() => setActiveTab('personal')} />
          <Chip size="small" variant="outlined" color={readiness.billing ? "success" : "warning"}
            label={readiness.billing ? "Billing details added" : "Add billing address"}
            onClick={() => setActiveTab('personal')} />
          {!isOrganizer && <Chip size="small" variant="outlined" label="Set up as organizer" component="a" clickable href="/complete-profile?intent=organizer&callbackUrl=%2Fadmin" />}
        </Stack>
        <Typography variant="body2" color="text.secondary">Your photo, bio and pronouns are optional. Check-in details are private.</Typography>
      </Stack>

      {(!readiness.checkIn || !readiness.billing) && (
        <Alert severity="warning" action={<Button color="inherit" size="small" href="/complete-profile?intent=billing&callbackUrl=%2Fprofile">Complete now</Button>}>
          Complete your legal name and billing address before ticket sales open to avoid delays when booking. Your details are private.
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3, alignItems: 'flex-start' }}>
        <Tabs
          value={activeTab}
          onChange={(_, value: string) => setActiveTab(value)}
          orientation={desktop ? 'vertical' : 'horizontal'}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          aria-label="Profile settings"
          sx={{
            width: { xs: '100%', md: 220 },
            flexShrink: 0,
            position: { md: 'sticky' },
            top: { md: 88 },
            borderBottom: { xs: 1, md: 0 },
            borderColor: 'divider',
            '& .MuiTab-root': { alignItems: 'flex-start', textAlign: 'left', textTransform: 'none' },
          }}
        >
          {PROFILE_TABS.map(tab => (
            <Tab key={tab.value} value={tab.value} label={tab.label} id={`profile-tab-${tab.value}`} aria-controls={`profile-panel-${tab.value}`} />
          ))}
        </Tabs>
        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          <Box role="tabpanel" id="profile-panel-general" aria-labelledby="profile-tab-general" hidden={activeTab !== 'general'} tabIndex={0}>
            {activeTab === 'general' && (
              <Stack spacing={2.5}>
                <Box sx={sectionSx}>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="h5" fontWeight={700}>
                      Profile Pictures
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {profilePictures.length} uploaded photo{profilePictures.length === 1 ? '' : 's'}
                    </Typography>
                  </Box>
                  <ProfilePictureGallery
                    userId={user.id}
                    profilePictures={profilePictures}
                    userName={formData.name}
                    userEmail={user.email}
                    onPicturesUpdate={refreshProfilePictures}
                  />
                </Box>

                <Box sx={sectionSx}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" sx={{ mb: 3 }}>
                    <Box>
                      <Typography variant="h5" fontWeight={700}>
                        Basic Information
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Public profile details and discoverability.
                      </Typography>
                    </Box>
                    <Chip icon={<Public />} label={formData.country ? 'Public profile ready' : 'Country optional'} size="small" color={formData.country ? 'primary' : 'default'} />
                  </Stack>

                  <Stack spacing={3}>
                    <TextField
                      label="Display Name"
                      value={formData.name}
                      onChange={handleInputChange('name')}
                      fullWidth
                      error={displayNameTooLong}
                      inputProps={{ maxLength: DISPLAY_NAME_MAX_LENGTH }}
                      helperText={displayNameTooLong
                        ? `Display name must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`
                        : `${displayNameLength}/${DISPLAY_NAME_MAX_LENGTH} characters`}
                    />

                    <TextField
                      label="Username"
                      value={formData.username}
                      onChange={handleInputChange('username')}
                      fullWidth
                      inputProps={{ maxLength: DISPLAY_NAME_MAX_LENGTH }}
                      helperText="Shown in your profile URL and @mentions. No spaces - use hyphens or underscores instead."
                    />

                    <CountryAutocomplete
                      label="Country"
                      value={formData.country}
                      onChange={(value) => setFormData(prev => ({ ...prev, country: value }))}
                      helperText="Shown on your profile with a flag"
                    />

                    <TextField
                      label="Bio"
                      value={formData.bio}
                      onChange={handleInputChange('bio')}
                      multiline
                      rows={4}
                      fullWidth
                      placeholder={isOrganization ? "Tell us about your organization..." : "Tell us about yourself..."}
                      inputProps={{ maxLength: 500 }}
                      helperText={`${formData.bio.length}/500 characters`}
                    />

                  </Stack>
                </Box>

                {!isOrganization && (
                  <Box sx={sectionSx}>
                    <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>
                      My Registrations
                    </Typography>
                    <MyRegistrations userId={user.id} />
                  </Box>
                )}
              </Stack>
            )}
          </Box>
          <Box role="tabpanel" id="profile-panel-personal" aria-labelledby="profile-tab-personal" hidden={activeTab !== 'personal'} tabIndex={0}>
            {activeTab === 'personal' && (
              <Stack spacing={2.5}>
                <Box sx={sectionSx}>
                  <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
                    Personal Information
                  </Typography>
                  <Stack spacing={3}>
                    <Accordion variant="outlined" disableGutters sx={{ borderRadius: 1, '&:before': { display: 'none' } }}>
                      <AccordionSummary
                        expandIcon={<ExpandMore />}
                        sx={{ '& .MuiAccordionSummary-content': { minWidth: 0, overflow: 'hidden' } }}
                      >
                        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0, flex: 1, pr: 1 }}>
                          <Badge color="action" sx={{ flexShrink: 0 }} />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="subtitle1" fontWeight={700}>
                              {isOrganization ? "Organization Details" : "Check-in Identity"}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {isOrganization
                                ? "Legal name and address of your organization."
                                : "Your legal name and billing address are required before booking a ticket. These details are private."}
                            </Typography>
                          </Box>
                          <Chip
                            label={identityReady ? 'Complete' : hasIdentityDetails ? 'Incomplete' : 'Not added'}
                            size="small"
                            color={identityReady ? 'success' : hasIdentityDetails ? 'warning' : 'default'}
                            sx={{ flexShrink: 0 }}
                          />
                        </Stack>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Stack spacing={2.5}>
                          <Alert severity="info">
                            This information is used for ticket billing and event check-in. It is not shown on your public profile.
                          </Alert>

                          <TextField
                            label="Legal Name"
                            value={formData.legalName}
                            onChange={handleInputChange('legalName')}
                            fullWidth
                            inputProps={{ maxLength: 200 }}
                            helperText="Used by event staff for ID checks."
                          />

                          <TextField
                            label="Address"
                            value={formData.addressLine1}
                            onChange={handleInputChange('addressLine1')}
                            fullWidth
                            autoComplete="street-address"
                            inputProps={{ maxLength: 200 }}
                          />

                          <TextField
                            label="Address line 2"
                            value={formData.addressLine2}
                            onChange={handleInputChange('addressLine2')}
                            fullWidth
                            autoComplete="address-line2"
                            inputProps={{ maxLength: 200 }}
                          />

                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                            <TextField
                              label="City"
                              value={formData.addressCity}
                              onChange={handleInputChange('addressCity')}
                              fullWidth
                              autoComplete="address-level2"
                              inputProps={{ maxLength: 120 }}
                            />

                            <TextField
                              label="State/Region"
                              value={formData.addressState}
                              onChange={handleInputChange('addressState')}
                              fullWidth
                              autoComplete="address-level1"
                              inputProps={{ maxLength: 120 }}
                            />
                          </Stack>

                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                            <TextField
                              label="Postal code"
                              value={formData.addressPostalCode}
                              onChange={handleInputChange('addressPostalCode')}
                              fullWidth
                              autoComplete="postal-code"
                              inputProps={{ maxLength: 40 }}
                            />

                            <CountryAutocomplete
                              label="Address country"
                              value={formData.addressCountry}
                              onChange={(value) => setFormData(prev => ({ ...prev, addressCountry: value }))}
                            />
                          </Stack>
                        </Stack>
                      </AccordionDetails>
                    </Accordion>

                    {!isOrganization && (
                      <>
                        <TextField
                          label="Date of Birth"
                          type="date"
                          value={formData.dateOfBirth}
                          onChange={handleInputChange('dateOfBirth')}
                          fullWidth
                          helperText="Your age will only be shown if you enable it in privacy settings"
                          InputLabelProps={{ shrink: true }}
                          inputProps={{
                            min: birthDateBounds.min,
                            max: birthDateBounds.max,
                          }}
                        />

                        {displayedAge !== null && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Chip
                              label={`Age: ${displayedAge}`}
                              color={formData.showAge ? 'primary' : 'default'}
                              icon={formData.showAge ? <Visibility /> : <VisibilityOff />}
                            />
                            <Typography variant="body2" color="text.secondary">
                              {formData.showAge ? 'Visible to others' : 'Hidden from others'}
                            </Typography>
                          </Box>
                        )}

                        <TextField
                          label="Pronouns"
                          value={formData.pronouns}
                          onChange={handleInputChange('pronouns')}
                          select
                          fullWidth
                          helperText="Help others know how to refer to you"
                        >
                          {PRONOUN_OPTIONS.map((option) => (
                            <MenuItem key={option} value={option}>
                              {option}
                            </MenuItem>
                          ))}
                        </TextField>
                        {formData.pronouns === "choose my own pronouns" && (
                          <TextField
                            label="Custom Pronouns"
                            type="text"
                            value={formData.customPronouns}
                            onChange={handleInputChange('customPronouns')}
                            fullWidth
                            inputProps={{ maxLength: 50 }}
                          />
                        )}
                      </>
                    )}
                  </Stack>
                </Box>

                {!isOrganization && (
                  <Box sx={sectionSx}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" sx={{ mb: 2 }}>
                      <Box>
                        <Typography variant="h5" fontWeight={700}>
                          Privacy Settings
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Control what appears on your public profile.
                        </Typography>
                      </Box>
                      <Chip
                        icon={formData.showAge ? <Visibility /> : <VisibilityOff />}
                        label={formData.showAge ? 'Age visible' : 'Age hidden'}
                        color={formData.showAge ? 'primary' : 'default'}
                        size="small"
                      />
                    </Stack>

                    <Stack spacing={2}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={formData.showAge}
                            onChange={(e) => setFormData(prev => ({ ...prev, showAge: e.target.checked }))}
                          />
                        }
                        label="Show my age publicly"
                      />
                      <Typography variant="body2" color="text.secondary">
                        When enabled, your age will be visible to other users.
                      </Typography>

                      <FormControlLabel
                        control={
                          <Switch
                            checked={formData.showConventions}
                            onChange={(e) => setFormData(prev => ({ ...prev, showConventions: e.target.checked }))}
                          />
                        }
                        label="Show all my events publicly"
                      />
                      <Typography variant="body2" color="text.secondary">
                        Show all your past and upcoming confirmed events on your public profile. Tickets and payment details stay private.
                      </Typography>

                      {formData.showAge && (
                        <>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={formData.showExactBirthdate}
                                onChange={(e) => setFormData(prev => ({ ...prev, showExactBirthdate: e.target.checked }))}
                              />
                            }
                            label="Show exact birth date (not just age)"
                          />
                          <Typography variant="body2" color="text.secondary">
                            When enabled, your exact birth date is shown in addition to your age.
                          </Typography>
                        </>
                      )}
                    </Stack>
                  </Box>
                )}
              </Stack>
            )}
          </Box>
          <Box role="tabpanel" id="profile-panel-socials" aria-labelledby="profile-tab-socials" hidden={activeTab !== 'socials'} tabIndex={0}>
            {activeTab === 'socials' && (
              <Stack spacing={2.5}>
                <Box sx={sectionSx}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" sx={{ mb: 2 }}>
                    <Box>
                      <Typography variant="h5" fontWeight={700}>
                        Social Links
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Usernames appear as clickable profile chips.
                      </Typography>
                    </Box>
                    <Chip
                      label={`${Object.values(formData.socialLinks).filter(Boolean).length}/3 linked`}
                      size="small"
                    />
                  </Stack>

                  <Stack spacing={2}>
                    <TextField
                      label="Telegram"
                      value={formData.socialLinks.telegram}
                      onChange={handleSocialChange('telegram')}
                      fullWidth
                      placeholder="username"
                      inputProps={{ maxLength: 100 }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <Telegram color="action" />
                          </InputAdornment>
                        )
                      }}
                      helperText={renderSocialLink('https://t.me/', formData.socialLinks.telegram)}
                    />
                    <TextField
                      label="Twitter / X"
                      value={formData.socialLinks.twitter}
                      onChange={handleSocialChange('twitter')}
                      fullWidth
                      placeholder="username"
                      inputProps={{ maxLength: 100 }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <Twitter color="action" />
                          </InputAdornment>
                        )
                      }}
                      helperText={renderSocialLink('https://x.com/', formData.socialLinks.twitter)}
                    />
                    <TextField
                      label="Instagram"
                      value={formData.socialLinks.instagram}
                      onChange={handleSocialChange('instagram')}
                      fullWidth
                      placeholder="username"
                      inputProps={{ maxLength: 100 }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <PhotoCamera color="action" />
                          </InputAdornment>
                        )
                      }}
                      helperText={renderSocialLink('https://instagram.com/', formData.socialLinks.instagram)}
                    />
                  </Stack>
                </Box>
              </Stack>
            )}
          </Box>
          <Box role="tabpanel" id="profile-panel-auth" aria-labelledby="profile-tab-auth" hidden={activeTab !== 'auth'} tabIndex={0}>
            {activeTab === 'auth' && (
              <Stack spacing={2.5}>
                <Box component="form" sx={sectionSx} onSubmit={handleChangeEmail}>
                  <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
                    Email Address
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Current email: {user.email}. Confirm the change from your current inbox, then verify your new address.
                  </Typography>
                  <Stack spacing={2}>
                    {emailRequested && (
                      <Alert severity="success">
                        Request received. If the new address is available, check your current inbox to approve the change, then your new inbox to verify it. Your email stays unchanged until verification is complete.
                      </Alert>
                    )}
                    <TextField
                      label="New email address"
                      type="email"
                      autoComplete="email"
                      required
                      fullWidth
                      value={newEmail}
                      onChange={event => {
                        setNewEmail(event.target.value);
                        setEmailRequested(false);
                      }}
                    />
                    <Button
                      type="submit"
                      variant="outlined"
                      disabled={changingEmail || !newEmail.trim() || newEmail.trim().toLowerCase() === user.email.toLowerCase()}
                      sx={{ alignSelf: 'flex-start' }}
                    >
                      {changingEmail ? 'Sending...' : 'Change Email'}
                    </Button>
                  </Stack>
                </Box>

                <Box>
                  <LinkedAccounts
                    accounts={user.accounts}
                    hasPassword={!!user.accounts.find(a => a.providerId === 'credential')?.password}
                  />
                </Box>
              </Stack>
            )}
          </Box>
          <Box role="tabpanel" id="profile-panel-advanced" aria-labelledby="profile-tab-advanced" hidden={activeTab !== 'advanced'} tabIndex={0}>
            {activeTab === 'advanced' && (
              <Stack spacing={2.5}>
                <Box sx={sectionSx}>
                  <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>
                    Account Management
                  </Typography>

                  <Stack spacing={2}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="h6" gutterBottom>
                          Download Your Data
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Export all your personal data as required by GDPR. This includes your profile, events, and any other data we have stored.
                        </Typography>
                      </CardContent>
                      <CardActions>
                        <Button
                          variant="outlined"
                          startIcon={<Download />}
                          onClick={() => setDownloadDialogOpen(true)}
                        >
                          Download Data
                        </Button>
                      </CardActions>
                    </Card>

                    <Card variant="outlined" sx={{ borderColor: 'error.main' }}>
                      <CardContent>
                        <Typography variant="h6" gutterBottom color="error">
                          Delete Account
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Permanently delete your account and all associated data. This action cannot be undone.
                        </Typography>
                      </CardContent>
                      <CardActions>
                        <Button
                          variant="outlined"
                          color="error"
                          startIcon={<Delete />}
                          onClick={() => setDeleteDialogOpen(true)}
                        >
                          Delete Account
                        </Button>
                      </CardActions>
                    </Card>
                  </Stack>
                </Box>
              </Stack>
            )}
          </Box>
          {['general', 'personal', 'socials'].includes(activeTab) && (
            <Box
              sx={{
                position: 'sticky',
                bottom: 16,
                zIndex: 2,
                display: 'flex',
                justifyContent: 'flex-end',
                mt: 2.5,
              }}
            >
              <Button
                variant="contained"
                size="large"
                startIcon={<Save />}
                onClick={() => {
                  handleSave().catch(err => {
                    setError(err instanceof Error ? err.message : 'Failed to update profile');
                  });
                }}
                disabled={saving || displayNameTooLong}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </Box>
          )}
        </Box>
      </Box>

      <DeleteAccountDialog onClose={() => setDeleteDialogOpen(false)} onDelete={handleDeleteAccount} open={deleteDialogOpen} userEmail={user.email} />

      <Dialog open={downloadDialogOpen} onClose={() => setDownloadDialogOpen(false)}>
        <DialogTitle>Download Your Data</DialogTitle>
        <DialogContent>
          <Typography>
            We will prepare a JSON file containing all your personal data. This includes:
          </Typography>
          <ul>
            <li>Profile information</li>
            <li>Event registrations</li>
            <li>Payment history</li>
            <li>Account settings</li>
          </ul>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDownloadDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              handleDownloadData().catch(err => {
                setError(err instanceof Error ? err.message : 'Failed to export data');
              });
            }}
          >
            Download
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function DeleteAccountDialog({
  open,
  userEmail,
  onClose,
  onDelete
}: {
  open: boolean;
  userEmail: string;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    const value = inputRef.current?.value.trim();
    if (value !== userEmail) {
      setError('Email does not match');
      return;
    }

    setError(null);
    setIsDeleting(true);

    try {
      await onDelete();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete account';
      setError(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby='delete-dialog-title'>
      <DialogTitle>Delete Account</DialogTitle>

      <DialogContent>
        <Typography>
          Are you sure you want to delete your account? This will permanently remove all your data and cannot be undone.
        </Typography>

        <Typography sx={{ mt: 2, fontWeight: 'bold' }}>
          Type &quot;{userEmail}&quot; to confirm:
        </Typography>

        <TextField
          fullWidth
          inputRef={inputRef}
          sx={{ mt: 1 }}
          error={!!error}
          placeholder={userEmail}
          helperText={error || 'This action cannot be undone'}
          disabled={isDeleting}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          onClick={() => void handleConfirmDelete()}
          disabled={isDeleting}
        >
          {isDeleting ? 'Deleting...' : 'Delete Account'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
