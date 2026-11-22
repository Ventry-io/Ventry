'use client';

import { Box, Typography } from '@mui/material';
import { LocationOn } from '@mui/icons-material';
import Image from 'next/image';
import Link from 'next/link';
import { kissCut } from '@/lib/ui/kissCut';

interface EventCardProps {
  event: {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
    imageUrl: string | null;
    location: {
      city: string;
      country: string;
    } | null;
  };
  priority?: boolean;
}

const month = (date: Date) => date.toLocaleDateString('en', { month: 'short' });
const day = (date: Date) => date.toLocaleDateString('en', { day: 'numeric' });

/** Day range for the sticker, e.g. "3" or "3–5"; spans across months fall back to the start day. */
function dayRange(start: Date, end: Date) {
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  return sameMonth && start.getDate() !== end.getDate() ? `${day(start)}–${day(end)}` : day(start);
}

export default function EventCard({ event, priority = false }: EventCardProps) {
  const start = new Date(event.startDate);
  const end = new Date(event.endDate);
  const fullDate = start.toLocaleDateString('en', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <Box
      component={Link}
      href={`/events/${event.id}`}
      sx={{
        display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', color: 'inherit', textDecoration: 'none', borderRadius: '16px',
        '&:hover .event-card-photo img': { transform: 'scale(1.03)' },
        '&:hover .event-card-date': { transform: 'rotate(-4deg) translateY(-2px)' },
        '&:focus-visible': { outlineOffset: 4 },
      }}
    >
      <Box className="event-card-photo" sx={{ position: 'relative', aspectRatio: '4 / 3', borderRadius: '16px', overflow: 'hidden', bgcolor: 'var(--liner)', border: '1px solid var(--rule)' }}>
        {event.imageUrl ? (
          <Image
            src={event.imageUrl}
            alt=""
            fill
            sizes="(min-width: 1200px) 380px, (min-width: 600px) 50vw, 100vw"
            preload={priority}
            loading={priority ? 'eager' : 'lazy'}
            style={{ objectFit: 'cover', transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        ) : (
          <Box aria-hidden sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', backgroundImage: 'radial-gradient(var(--rule-strong) 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
            <Box sx={{ ...kissCut, width: 88, height: 88, borderRadius: '50%', bgcolor: 'background.paper', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '2.5rem', color: 'text.secondary' }}>
              {event.name.trim()[0]?.toUpperCase()}
            </Box>
          </Box>
        )}
        <Box
          className="event-card-date"
          sx={{
            ...kissCut, position: 'absolute', top: 12, left: 12, minWidth: 64, px: 1.25, py: 0.75, borderRadius: '12px',
            bgcolor: 'background.paper', textAlign: 'center', lineHeight: 1, transform: 'rotate(-2deg)',
            transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <Typography component="span" sx={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-tomato)' }}>
            {month(start)}
          </Typography>
          <Typography component="span" sx={{ display: 'block', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.5rem', letterSpacing: '-0.02em' }}>
            {dayRange(start, end)}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ px: 0.5 }}>
        <Typography variant="h5" component="h2" sx={{ overflowWrap: 'anywhere' }}>{event.name}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{fullDate}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, color: 'text.secondary' }}>
          <LocationOn sx={{ fontSize: 16 }} aria-hidden />
          <Typography variant="body2">
            {event.location ? `${event.location.city}, ${event.location.country}` : 'Location to be announced'}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
