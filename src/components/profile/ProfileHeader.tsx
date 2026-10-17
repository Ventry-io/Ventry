"use client";

import { Box, Typography, Avatar, Chip, Stack } from "@mui/material";
import Telegram from "@mui/icons-material/Telegram";
import Twitter from "@mui/icons-material/Twitter";
import Instagram from "@mui/icons-material/Instagram";
import Image from "next/image";
import { getCountryFlag, getCountryByCode } from "@/lib/countries";

interface ProfileHeaderProps {
  name: string | null;
  username?: string | null;
  pronouns: string | null;
  profilePictures: Array<{ signedUrl?: string | null; isPrimary: boolean }>;
  age: number | null;
  showAge: boolean;
  country?: string | null;
  socialLinks?: { telegram?: string; twitter?: string; instagram?: string } | null;
  eventCounts?: { attended: number; upcoming: number };
}

export default function ProfileHeader({
  name, username, pronouns, profilePictures, age, showAge, country, socialLinks, eventCounts,
}: ProfileHeaderProps) {
  const primaryPicture = profilePictures.find(pic => pic.isPrimary) || profilePictures[0];
  const countryData = country ? getCountryByCode(country) : null;
  const initials = name?.trim().split(/\s+/).map(word => word[0]).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <Box>
      <Box sx={{ height: { xs: 88, sm: 120 }, bgcolor: 'primary.main', backgroundImage: 'linear-gradient(115deg, #0d3155, #1976d2)' }} />
      <Box sx={{ px: { xs: 2.5, sm: 4 }, pb: 3 }}>
        <Avatar sx={{ width: 128, height: 128, mt: -8, mb: 2, border: '5px solid', borderColor: 'background.paper', bgcolor: 'primary.dark', fontSize: 40 }}>
          {primaryPicture?.signedUrl ? (
            <Image src={primaryPicture.signedUrl} alt={`${name || 'User'}'s profile`} fill sizes="128px" style={{ objectFit: 'cover' }} unoptimized preload />
          ) : initials}
        </Avatar>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} justifyContent="space-between" alignItems={{ sm: 'center' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography component="h1" variant="h4" fontWeight={800} sx={{ overflowWrap: 'anywhere' }}>{name || 'Anonymous User'}</Typography>
            {username && <Typography color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>@{username}</Typography>}
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
              {pronouns && <Chip label={pronouns} size="small" variant="outlined" />}
              {countryData && <Chip label={`${getCountryFlag(countryData.code)} ${countryData.name}`} size="small" variant="outlined" />}
              {age !== null && showAge && <Chip label={`${age} years old`} size="small" variant="outlined" />}
            </Stack>
          </Box>
          {eventCounts && (
            <Stack direction="row" spacing={3} sx={{ flexShrink: 0 }}>
              {[
                { label: 'Attended', value: eventCounts.attended, href: '#attended-events' },
                { label: 'Upcoming', value: eventCounts.upcoming, href: '#upcoming-events' },
              ].map(stat => (
                <Box component="a" key={stat.label} href={stat.href} sx={{ color: 'inherit', textDecoration: 'none', textAlign: 'center', borderRadius: 1, px: 1, '&:hover': { bgcolor: 'action.hover' } }}>
                  <Typography variant="h5" component="span" fontWeight={800} sx={{ display: 'block' }}>{stat.value}</Typography>
                  <Typography variant="body2" component="span" color="text.secondary">{stat.label}</Typography>
                </Box>
              ))}
            </Stack>
          )}
        </Stack>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 2, '&:empty': { display: 'none' } }}>
          {[
            { handle: socialLinks?.telegram, base: 'https://t.me/', Icon: Telegram, label: 'Telegram' },
            { handle: socialLinks?.twitter, base: 'https://x.com/', Icon: Twitter, label: 'Twitter / X' },
            { handle: socialLinks?.instagram, base: 'https://instagram.com/', Icon: Instagram, label: 'Instagram' },
          ].map(({ handle, base, Icon, label }) => handle?.trim() ? (
            <Chip key={label} icon={<Icon />} label={`@${handle}`} aria-label={`${label}: @${handle}`} component="a" href={`${base}${encodeURIComponent(handle.trim().replace(/^@/, ''))}`} target="_blank" rel="noopener noreferrer" variant="outlined" size="small" clickable sx={{ maxWidth: '100%' }} />
          ) : null)}
        </Stack>
      </Box>
    </Box>
  );
}
