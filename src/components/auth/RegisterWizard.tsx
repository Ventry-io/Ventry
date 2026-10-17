"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";
import {
  ArrowBack,
  ArrowForward,
  Business,
  ConfirmationNumber,
  Person,
  Visibility,
  VisibilityOff,
  Google,
  GitHub,
} from "@mui/icons-material";
import { alpha } from "@mui/material/styles";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { z } from "zod";
import authClient from "@/lib/auth/client";
import PasswordStrengthMeter from "./PasswordStrengthMeter";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/user/display-name";
import { requiredCountryCodeSchema } from "@/types/schemas/country";
import CountryAutocomplete from "@/components/common/CountryAutocomplete";
import { getCallbackPath } from "@/lib/auth/callback";
import { usernameSchema } from "@/types/schemas/signup";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const accountSchema = z
  .object({
    email: z.string().trim().email("Invalid email address"),
    username: usernameSchema,
    password: z
      .string()
      .min(8, "Min 8 characters")
      .regex(/[A-Z]/, "Must contain an uppercase letter")
      .regex(/[0-9]/, "Must contain a number"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

const personalSchema = z.object({
  legalName: z.string().trim().min(2, "Required").max(200, "Max 200 characters"),
  addressLine1: z.string().trim().min(2, "Required").max(200, "Max 200 characters"),
  addressLine2: z.string().trim().max(200, "Max 200 characters").optional(),
  addressCity: z.string().trim().min(2, "Required").max(120, "Max 120 characters"),
  addressState: z.string().trim().max(120, "Max 120 characters").optional(),
  addressPostalCode: z.string().trim().min(2, "Required").max(40, "Max 40 characters"),
  addressCountry: requiredCountryCodeSchema,
});

const orgSchema = z.object({
  orgName: z.string().trim().min(2, "Min 2 characters").max(100, "Max 100 characters"),
  orgSlug: z
    .string()
    .trim()
    .min(2, "Min 2 characters")
    .max(50, "Max 50 characters")
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only"),
  orgDescription: z.string().trim().max(500, "Max 500 characters").optional(),
});

type AccountData = z.infer<typeof accountSchema>;
type PersonalData = z.infer<typeof personalSchema>;
type OrgData = z.infer<typeof orgSchema>;
type Path = "ATTENDEE" | "ORGANIZER";
type OrganizerType = "INDIVIDUAL" | "ORGANIZATION";

// ─── Step indices ─────────────────────────────────────────────────────────────

const S_ACCOUNT = 0;
const S_PATH = 1;
const S_PERSONAL = 2;
const S_ORGANIZER_TYPE = 3;
const S_ORG_DETAILS = 4;

// ─── Selection Card ───────────────────────────────────────────────────────────

function SelectionCard({
  selected,
  onSelect,
  icon,
  title,
  description,
  badge,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <Paper
      variant="outlined"
      component="label"
      sx={{
        p: 3,
        cursor: "pointer",
        display: "block",
        position: "relative",
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: selected
          ? (t) => alpha(t.palette.primary.main, 0.05)
          : "background.paper",
        transition: "all 0.15s ease",
        "&:hover": {
          borderColor: "primary.light",
          bgcolor: (t) => alpha(t.palette.primary.main, 0.03),
        },
        "&:focus-within": {
          outline: "2px solid",
          outlineColor: "primary.main",
          outlineOffset: 2,
        },
        height: "100%",
        minHeight: 160,
      }}
    >
      <Box component="input" type="radio" name="account-type" checked={selected} onChange={onSelect}
        sx={{ position: "absolute", opacity: 0, width: 1, height: 1 }} />
      <Stack alignItems="center" spacing={1.5} textAlign="center">
        <Box
          sx={{
            color: selected ? "primary.main" : "text.secondary",
            display: "flex",
          }}
        >
          {icon}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="h6" fontWeight={700}>
            {title}
          </Typography>
          {badge && (
            <Chip label={badge} size="small" color="secondary" variant="outlined" />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      </Stack>
    </Paper>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

export default function RegisterWizard({
  callbackUrl,
}: {
  callbackUrl?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(S_ACCOUNT);
  const [path, setPath] = useState<Path | null>(null);
  const [organizerType, setOrganizerType] = useState<OrganizerType | null>(null);
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [personalData, setPersonalData] = useState<PersonalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [socialProvider, setSocialProvider] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const callback = getCallbackPath(callbackUrl);

  useEffect(() => {
    contentRef.current?.focus();
  }, [step]);
  const [pwWarning, setPwWarning] = useState<{
    message: string | null;
    suggestions: string[];
  } | null>(null);

  // Per-step forms
  const accountForm = useForm<AccountData>({
    resolver: zodResolver(accountSchema),
    mode: "onBlur",
  });
  const personalForm = useForm<PersonalData>({
    resolver: zodResolver(personalSchema),
    mode: "onBlur",
  });
  const orgForm = useForm<OrgData>({
    resolver: zodResolver(orgSchema),
    mode: "onBlur",
  });

  const password = useWatch({ control: accountForm.control, name: "password", defaultValue: "" });
  const orgNameValue = useWatch({ control: orgForm.control, name: "orgName", defaultValue: "" });
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  const generateSlug = useCallback(
    (name: string) =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    [],
  );

  // Auto-fill slug from org name
  useEffect(() => {
    if (!slugManuallyEdited && orgNameValue) {
      orgForm.setValue("orgSlug", generateSlug(orgNameValue), {
        shouldValidate: step === S_ORG_DETAILS,
      });
    }
  }, [orgNameValue, orgForm, generateSlug, step, slugManuallyEdited]);

  // Dynamic stepper labels
  const steps = [
    "Account",
    "Your path",
    ...(path === "ORGANIZER" ? ["Billing details", "Organizer type"] : []),
    ...(path === "ORGANIZER" && organizerType === "ORGANIZATION"
      ? ["Organization"]
      : []),
  ];

  const go = (n: number) => {
    setError(null);
    setStep(n);
  };

  // ── Step handlers ──────────────────────────────────────────────────────────

  const onAccountNext = accountForm.handleSubmit(async (data) => {
    setError(null);
    try {
      const res = await fetch("/api/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email }),
      });
      const { exists } = (await res.json()) as { exists: boolean };
      if (exists) {
        accountForm.setError("email", {
          message: "An account with this email already exists.",
        });
        return;
      }
    } catch {
      // non-blocking
    }
    try {
      const res = await fetch(`/api/user/username?username=${encodeURIComponent(data.username)}`);
      if (res.ok && !(await res.json()).available) {
        accountForm.setError("username", { message: "This username is taken. Choose another." }, { shouldFocus: true });
        return;
      }
    } catch {
      // The server validates availability again when creating the account.
    }
    setAccountData(data);
    go(S_PATH);
  });

  const onPathNext = () => {
    if (!path) {
      setError("Please choose a path to continue.");
      return;
    }
    if (path === "ATTENDEE") void submitAttendee();
    else go(S_PERSONAL);
  };

  const onPersonalNext = personalForm.handleSubmit((data) => {
    setPersonalData(data);
    go(S_ORGANIZER_TYPE);
  });

  const onOrganizerTypeNext = () => {
    if (!organizerType) {
      setError("Please choose your organizer type.");
      return;
    }
    if (organizerType === "INDIVIDUAL") {
      void submitOrganizer(null);
    } else {
      go(S_ORG_DETAILS);
    }
  };

  const onOrgDetailsNext = orgForm.handleSubmit((data) => {
    void submitOrganizer(data);
  });

  // ── Submit helpers ─────────────────────────────────────────────────────────

  const verificationCallback = path === "ORGANIZER"
    ? `/complete-profile?intent=organizer&callbackUrl=${encodeURIComponent(callback)}`
    : callback;
  const redirectUrl = `/check-email?email=${encodeURIComponent(accountData?.email ?? "")}&callbackUrl=${encodeURIComponent(verificationCallback)}`;

  const submitAttendee = async () => {
    if (!accountData) return;
    setSubmitting(true);
    setError(null);
    try {
      const { confirmPassword: _, ...payload } = accountData;
      const { error } = await authClient.signUp.email({
        email: payload.email,
        name: payload.username,
        password: payload.password,
        callbackURL: callback,
      });
      if (error) {
        setError(error.message || "Registration failed");
        return;
      }
      router.push(redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const submitOrganizer = async (org: OrgData | null) => {
    if (!accountData || !personalData || !organizerType) return;
    setSubmitting(true);
    setError(null);
    try {
      const { confirmPassword: _, ...account } = accountData;
      const res = await fetch("/api/auth/register-organizer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: account.email,
          username: account.username,
          password: account.password,
          callbackURL: callback,
          ...personalData,
          organizerType,
          ...(org
            ? {
                orgName: org.orgName,
                orgSlug: org.orgSlug,
                orgDescription: org.orgDescription,
              }
            : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error || "Registration failed");
        return;
      }
      router.push(redirectUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  const signUpSocial = async (provider: "google" | "github") => {
    setSocialProvider(provider);
    setError(null);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: callback,
        newUserCallbackURL: `/complete-profile?callbackUrl=${encodeURIComponent(callback)}`,
      });
      if (result.error) {
        setError(result.error.message || "Sign-up could not start. Please try again.");
        setSocialProvider(null);
      }
    } catch {
      setError("Connection interrupted. Please try again.");
      setSocialProvider(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Box ref={contentRef} tabIndex={-1} aria-label={`Registration: ${steps[step]}`} sx={{ outline: "none" }}>
      <Stepper activeStep={step} alternativeLabel sx={{ mb: 4, '& .MuiStepLabel-label': { fontSize: { xs: '0.7rem', sm: '0.875rem' }, wordBreak: 'break-word' }, '& .MuiStep-root': { px: { xs: 0.5, sm: 1 } } }}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* ── Step 0: Account ─────────────────────────────────────────────── */}
      {step === S_ACCOUNT && (
        <>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3 }}>
            <Button fullWidth variant="outlined" color="secondary" startIcon={<Google />} disabled={!!socialProvider} onClick={() => void signUpSocial("google")}>Continue with Google</Button>
            <Button fullWidth variant="outlined" color="secondary" startIcon={<GitHub />} disabled={!!socialProvider} onClick={() => void signUpSocial("github")}>Continue with GitHub</Button>
          </Stack>
          {socialProvider && <Typography role="status" variant="body2" textAlign="center" sx={{ mb: 2 }}>Opening {socialProvider === "google" ? "Google" : "GitHub"}…</Typography>}
          <Divider sx={{ mb: 2 }}><Typography variant="body2" color="text.secondary">or use your email</Typography></Divider>
        <Box
          component="form"
          onSubmit={(e) => void onAccountNext(e)}
          noValidate
        >
          <TextField
            margin="normal"
            required
            fullWidth
            label="Email"
            type="email"
            autoComplete="email"
            {...accountForm.register("email")}
            error={!!accountForm.formState.errors.email}
            helperText={accountForm.formState.errors.email?.message || " "}
          />

          <TextField
            margin="normal"
            required
            fullWidth
            label="Username"
            autoComplete="username"
            inputProps={{ maxLength: DISPLAY_NAME_MAX_LENGTH }}
            {...accountForm.register("username")}
            error={!!accountForm.formState.errors.username}
            helperText={
              accountForm.formState.errors.username?.message ||
              "Your public name. Letters, numbers, dots, hyphens and underscores."
            }
          />

          <TextField
            margin="normal"
            required
            fullWidth
            label="Password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            {...accountForm.register("password")}
            error={!!accountForm.formState.errors.password}
            helperText={accountForm.formState.errors.password?.message || "At least 8 characters, one uppercase letter and one number."}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      onClick={() => setShowPassword((s) => !s)}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />

          <PasswordStrengthMeter
            password={password}
            setWarning={setPwWarning}
          />

          <TextField
            margin="normal"
            required
            fullWidth
            label="Confirm password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            {...accountForm.register("confirmPassword")}
            error={!!accountForm.formState.errors.confirmPassword}
            helperText={
              accountForm.formState.errors.confirmPassword?.message || " "
            }
          />

          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={!!pwWarning || accountForm.formState.isSubmitting || !!socialProvider}
            endIcon={<ArrowForward />}
            sx={{ mt: 3, mb: 1, py: 1.5 }}
          >
            {accountForm.formState.isSubmitting ? "Checking…" : "Continue"}
          </Button>
        </Box>
        </>
      )}

      {/* ── Step 1: Path selection ───────────────────────────────────────── */}
      {step === S_PATH && (
        <Box>
          <Typography variant="h6" gutterBottom fontWeight={600}>
            How will you use Ventry?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            You can always change this later.
          </Typography>

          <Grid container spacing={2} role="radiogroup" aria-label="How will you use Ventry?">
            <Grid size={{ xs: 12, sm: 6 }}>
              <SelectionCard
                selected={path === "ATTENDEE"}
                onSelect={() => setPath("ATTENDEE")}
                icon={<ConfirmationNumber sx={{ fontSize: 40 }} />}
                title="Attendee"
                description="Discover events, register, and connect with the community."
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <SelectionCard
                selected={path === "ORGANIZER"}
                onSelect={() => setPath("ORGANIZER")}
                icon={<Business sx={{ fontSize: 40 }} />}
                title="Organizer"
                description="Create and manage your own events, sell tickets, and build your audience."
                badge="Pro"
              />
            </Grid>
          </Grid>

          <Stack
            direction="row"
            justifyContent="space-between"
            sx={{ mt: 3 }}
          >
            <Button
              onClick={() => go(S_ACCOUNT)}
              disabled={submitting}
              startIcon={<ArrowBack />}
              variant="text"
            >
              Back
            </Button>
            <Button
              onClick={onPathNext}
              disabled={submitting}
              variant="contained"
              size="large"
              endIcon={<ArrowForward />}
              sx={{ py: 1.25 }}
            >
              {submitting ? "Creating account…" : path === "ATTENDEE" ? "Create account" : "Continue"}
            </Button>
          </Stack>
        </Box>
      )}

      {/* ── Step 2: Personal details ─────────────────────────────────────── */}
      {step === S_PERSONAL && (
        <Box
          component="form"
          onSubmit={(e) => void onPersonalNext(e)}
          noValidate
        >
          <Alert severity="info" sx={{ mb: 2 }}>
            Your legal details are used for billing and compliance purposes and are not shown publicly.
          </Alert>

          <TextField
            margin="normal"
            required
            fullWidth
            label="Legal / Organization name"
            autoComplete="name"
            inputProps={{ maxLength: 200 }}
            {...personalForm.register("legalName")}
            error={!!personalForm.formState.errors.legalName}
            helperText={personalForm.formState.errors.legalName?.message || " "}
          />

          <TextField
            margin="normal"
            required
            fullWidth
            label="Address"
            autoComplete="street-address"
            inputProps={{ maxLength: 200 }}
            {...personalForm.register("addressLine1")}
            error={!!personalForm.formState.errors.addressLine1}
            helperText={
              personalForm.formState.errors.addressLine1?.message || " "
            }
          />

          <TextField
            margin="normal"
            fullWidth
            label="Address line 2"
            autoComplete="address-line2"
            inputProps={{ maxLength: 200 }}
            {...personalForm.register("addressLine2")}
            error={!!personalForm.formState.errors.addressLine2}
            helperText={
              personalForm.formState.errors.addressLine2?.message || " "
            }
          />

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                margin="normal"
                required
                fullWidth
                label="City"
                autoComplete="address-level2"
                inputProps={{ maxLength: 120 }}
                {...personalForm.register("addressCity")}
                error={!!personalForm.formState.errors.addressCity}
                helperText={
                  personalForm.formState.errors.addressCity?.message || " "
                }
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                margin="normal"
                fullWidth
                label="State / Region"
                autoComplete="address-level1"
                inputProps={{ maxLength: 120 }}
                {...personalForm.register("addressState")}
                error={!!personalForm.formState.errors.addressState}
                helperText={
                  personalForm.formState.errors.addressState?.message || " "
                }
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                margin="normal"
                required
                fullWidth
                label="Postal code"
                autoComplete="postal-code"
                inputProps={{ maxLength: 40 }}
                {...personalForm.register("addressPostalCode")}
                error={!!personalForm.formState.errors.addressPostalCode}
                helperText={
                  personalForm.formState.errors.addressPostalCode?.message ||
                  " "
                }
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Controller
                control={personalForm.control}
                name="addressCountry"
                defaultValue=""
                render={({ field }) => (
                  <CountryAutocomplete
                    required
                    margin="normal"
                    value={field.value || ""}
                    onChange={field.onChange}
                    error={!!personalForm.formState.errors.addressCountry}
                    helperText={
                      personalForm.formState.errors.addressCountry?.message || " "
                    }
                  />
                )}
              />
            </Grid>
          </Grid>

          <Stack
            direction="row"
            justifyContent="space-between"
            sx={{ mt: 3 }}
          >
            <Button
              onClick={() => go(S_PATH)}
              startIcon={<ArrowBack />}
              variant="text"
              disabled={submitting}
            >
              Back
            </Button>
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={submitting}
              endIcon={<ArrowForward />}
              sx={{ py: 1.25 }}
            >
              Continue
            </Button>
          </Stack>
        </Box>
      )}

      {/* ── Step 3: Organizer type ───────────────────────────────────────── */}
      {step === S_ORGANIZER_TYPE && (
        <Box>
          <Typography variant="h6" gutterBottom fontWeight={600}>
            How would you like to organize?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Individual organizers manage events on their own. Organizations let
            you build a team with scoped permissions.
          </Typography>

          <Grid container spacing={2} role="radiogroup" aria-label="Organizer type">
            <Grid size={{ xs: 12, sm: 6 }}>
              <SelectionCard
                selected={organizerType === "INDIVIDUAL"}
                onSelect={() => setOrganizerType("INDIVIDUAL")}
                icon={<Person sx={{ fontSize: 40 }} />}
                title="Individual"
                description="Perfect for solo organizers. You own and manage all your events."
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <SelectionCard
                selected={organizerType === "ORGANIZATION"}
                onSelect={() => setOrganizerType("ORGANIZATION")}
                icon={<Business sx={{ fontSize: 40 }} />}
                title="Organization"
                description="Invite team members, assign roles, and manage events together."
              />
            </Grid>
          </Grid>

          <Stack
            direction="row"
            justifyContent="space-between"
            sx={{ mt: 3 }}
          >
            <Button
              onClick={() => go(S_PERSONAL)}
              startIcon={<ArrowBack />}
              variant="text"
              disabled={submitting}
            >
              Back
            </Button>
            <Button
              onClick={onOrganizerTypeNext}
              variant="contained"
              size="large"
              disabled={submitting}
              endIcon={
                submitting ? (
                  <CircularProgress size={18} />
                ) : organizerType === "INDIVIDUAL" ? undefined : (
                  <ArrowForward />
                )
              }
              sx={{ py: 1.25 }}
            >
              {organizerType === "INDIVIDUAL"
                ? submitting
                  ? "Creating account…"
                  : "Create account"
                : "Continue"}
            </Button>
          </Stack>
        </Box>
      )}

      {/* ── Step 4: Organization details ────────────────────────────────── */}
      {step === S_ORG_DETAILS && (
        <Box
          component="form"
          onSubmit={(e) => void onOrgDetailsNext(e)}
          noValidate
        >
          <Typography variant="h6" gutterBottom fontWeight={600}>
            Tell us about your organization
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            You can update these details later from your organizer dashboard.
          </Typography>

          <TextField
            margin="normal"
            required
            fullWidth
            label="Organization name"
            {...orgForm.register("orgName")}
            error={!!orgForm.formState.errors.orgName}
            helperText={orgForm.formState.errors.orgName?.message || " "}
          />

          <TextField
            margin="normal"
            required
            fullWidth
            label="URL slug"
            placeholder="my-organization"
            {...orgForm.register("orgSlug", {
              onChange: () => {
                setSlugManuallyEdited(true);
              },
            })}
            error={!!orgForm.formState.errors.orgSlug}
            helperText={
              orgForm.formState.errors.orgSlug?.message ||
              "Unique identifier used in URLs — lowercase, numbers and hyphens"
            }
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Typography variant="body2" color="text.secondary">
                      ventry.io/org/
                    </Typography>
                  </InputAdornment>
                ),
              },
            }}
          />

          <TextField
            margin="normal"
            fullWidth
            label="Description"
            multiline
            rows={3}
            {...orgForm.register("orgDescription")}
            error={!!orgForm.formState.errors.orgDescription}
            helperText={orgForm.formState.errors.orgDescription?.message || " "}
          />

          <Stack
            direction="row"
            justifyContent="space-between"
            sx={{ mt: 3 }}
          >
            <Button
              onClick={() => go(S_ORGANIZER_TYPE)}
              startIcon={<ArrowBack />}
              variant="text"
              disabled={submitting}
            >
              Back
            </Button>
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={submitting}
              endIcon={
                submitting ? <CircularProgress size={18} /> : undefined
              }
              sx={{ py: 1.25 }}
            >
              {submitting ? "Creating account…" : "Create account"}
            </Button>
          </Stack>
        </Box>
      )}

      <Box sx={{ mt: 3, textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          Already have an account?{" "}
          <Box
            component="a"
            href={`/login?callbackUrl=${encodeURIComponent(callback)}`}
            sx={{ color: "primary.main", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
          >
            Sign in
          </Box>
        </Typography>
      </Box>
    </Box>
  );
}
