"use client";

import { useState, useEffect, useCallback } from 'react';
import { 
  Box,
  Typography,
  Card,
  Chip,
  Dialog,
  DialogContent,
  IconButton,
  Fade,
  Stack,
  Paper
} from "@mui/material";
import {
  Close,
  ChevronLeft,
  ChevronRight,
  Star,
  StarBorder,
  Delete
} from "@mui/icons-material";
import Image from "next/image";

interface ProfilePicture {
  id: string;
  signedUrl?: string | null;
  isPrimary: boolean;
  createdAt: Date | string;
}

interface PhotoGalleryProps {
  profilePictures: ProfilePicture[];
  userName: string | null;
  // Optional management callbacks for when viewing own profile
  onSetPrimary?: (pictureId: string) => Promise<void>;
  onDelete?: (pictureId: string) => Promise<void>;
  isOwnProfile?: boolean;
}

// Photo grid component with clickable cards
interface PhotoGridProps {
  profilePictures: ProfilePicture[];
  userName: string | null;
  onImageClick: (index: number) => void;
}

const photoGridStyles = {
  container: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
    gap: 2
  },
  card: {
    position: 'relative',
    aspectRatio: '1',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'all 0.2s ease-in-out',
    '&:hover': {
      transform: 'scale(1.05)',
      boxShadow: 3
    }
  },
  placeholderBox: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    bgcolor: 'grey.200'
  },
  primaryChip: {
    position: 'absolute',
    top: 4,
    right: 4,
    fontSize: '0.6rem'
  }
};

// Navigation buttons component for the overlay
interface NavigationButtonsProps {
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

const navigationButtonStyles = {
  baseButton: {
    position: 'absolute',
    color: 'white',
    bgcolor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 1,
    '&:hover': {
      bgcolor: 'rgba(0, 0, 0, 0.7)'
    }
  },
  closeButton: {
    top: 20,
    right: 20
  },
  previousButton: {
    left: 20
  },
  nextButton: {
    right: 20
  },
  chevronIcon: {
    fontSize: '2rem'
  }
};
// Main image display component with fallback and primary badge
interface MainImageProps {
  currentPicture: ProfilePicture | undefined;
  currentIndex: number;
  userName: string | null;
  open: boolean;
}

const mainImageStyles = {
  outerContainer: {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  imageContainer: {
    position: 'relative',
    width: '90vw',
    height: '90vh',
    maxWidth: '90vw',
    maxHeight: '90vh'
  },
  primaryBadge: {
    position: 'absolute',
    top: 16,
    left: 16,
    px: 2,
    py: 1,
    bgcolor: 'primary.main',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    borderRadius: 2
  },
  starIcon: {
    fontSize: '1rem'
  },
  placeholderBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    bgcolor: 'grey.800',
    borderRadius: 2,
    width: 400,
    height: 400,
    color: 'white'
  }
};

// Thumbnail navigation strip component
interface ThumbnailStripProps {
  profilePictures: ProfilePicture[];
  currentIndex: number;
  userName: string | null;
  onThumbnailClick: (index: number) => void;
}

const thumbnailStripStyles = {
  container: {
    position: 'absolute',
    bottom: 80,
    left: '50%',
    transform: 'translateX(-50%)',
    bgcolor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 2,
    p: 1,
    maxWidth: '80vw',
    overflowX: 'auto'
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 1,
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    '&:hover': {
      border: '2px solid rgba(255, 255, 255, 0.7)'
    }
  },
  activeThumbnail: {
    border: '2px solid white'
  },
  inactiveThumbnail: {
    border: '2px solid transparent'
  },
  placeholderBox: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    bgcolor: 'grey.600',
    color: 'white'
  }
};

// Full overlay dialog component
interface OverlayDialogProps {
  open: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  currentPicture: ProfilePicture | undefined;
  currentIndex: number;
  profilePictures: ProfilePicture[];
  userName: string | null;
  onThumbnailClick: (index: number) => void;
  onSetPrimary?: (pictureId: string) => Promise<void>;
  onDelete?: (pictureId: string) => Promise<void>;
  isOwnProfile?: boolean;
}

const overlayDialogStyles = {
  dialog: {
    '& .MuiDialog-paper': {
      bgcolor: 'rgba(0, 0, 0, 0.95)',
      boxShadow: 'none',
      maxWidth: '100vw',
      maxHeight: '100vh',
      margin: 0,
      borderRadius: 0
    },
    '& .MuiBackdrop-root': {
      bgcolor: 'rgba(0, 0, 0, 0.9)'
    }
  },
  dialogContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    p: 0,
    height: '100vh',
    overflow: 'hidden'
  },
  imageCounter: {
    position: 'absolute',
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    px: 2,
    py: 1,
    bgcolor: 'rgba(0, 0, 0, 0.7)',
    color: 'white',
    borderRadius: 2
  },
  actionButtons: {
    position: 'absolute',
    top: 20,
    left: 20,
    display: 'flex',
    gap: 1,
    zIndex: 1
  }
};

const photoGalleryStyles = {
  title: {
    color: 'primary.main',
    fontWeight: 'bold',
    mb: 2
  }
};


function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map(word => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}


function PhotoGrid({ profilePictures, userName, onImageClick }: PhotoGridProps) {
  return (
    <Box sx={photoGridStyles.container}>
      {profilePictures.map((picture, index) => (
        <Card 
          key={picture.id}
          sx={photoGridStyles.card}
          onClick={() => onImageClick(index)}
        >
          {picture.signedUrl ? (
            <Image
              src={picture.signedUrl}
              alt="Profile picture"
              fill
              style={{ objectFit: 'cover' }}
              unoptimized={true}
            />
          ) : (
            <Box sx={photoGridStyles.placeholderBox}>
              <Typography variant="h6">
                {getInitials(userName)}
              </Typography>
            </Box>
          )}
          {picture.isPrimary && (
            <Chip
              label="Primary"
              color="primary"
              size="small"
              sx={photoGridStyles.primaryChip}
            />
          )}
        </Card>
      ))}
    </Box>
  );
}


function NavigationButtons({ onClose, onPrevious, onNext }: NavigationButtonsProps) {
  return (
    <>
      {/* Close Button */}
      <IconButton
        onClick={onClose}
        sx={{ ...navigationButtonStyles.baseButton, ...navigationButtonStyles.closeButton }}
      >
        <Close />
      </IconButton>

      {/* Previous Button */}
      <IconButton
        onClick={onPrevious}
        sx={{ ...navigationButtonStyles.baseButton, ...navigationButtonStyles.previousButton }}
      >
        <ChevronLeft sx={navigationButtonStyles.chevronIcon} />
      </IconButton>

      {/* Next Button */}
      <IconButton
        onClick={onNext}
        sx={{ ...navigationButtonStyles.baseButton, ...navigationButtonStyles.nextButton }}
      >
        <ChevronRight sx={navigationButtonStyles.chevronIcon} />
      </IconButton>
    </>
  );
}


function MainImage({ currentPicture, currentIndex, userName, open }: MainImageProps) {
  return (
    <Fade in={open} timeout={300}>
      <Box sx={mainImageStyles.outerContainer}>
        {currentPicture?.signedUrl ? (
          <Box sx={mainImageStyles.imageContainer}>
            <Image
              src={currentPicture.signedUrl}
              alt={`Profile picture ${currentIndex + 1}`}
              fill
              sizes="(max-width: 768px) 90vw, (max-width: 1200px) 80vw, 70vw"
              style={{
                objectFit: 'contain',
                borderRadius: '8px'
              }}
              priority
              unoptimized={true}
            />
            
            {/* Primary Badge for Overlay */}
            {currentPicture.isPrimary && (
              <Paper elevation={3} sx={mainImageStyles.primaryBadge}>
                <Star sx={mainImageStyles.starIcon} />
                <Typography variant="caption" fontWeight="bold">
                  Primary Photo
                </Typography>
              </Paper>
            )}
          </Box>
        ) : (
          <Box sx={mainImageStyles.placeholderBox}>
            <Typography variant="h2">
              {getInitials(userName)}
            </Typography>
          </Box>
        )}
      </Box>
    </Fade>
  );
}



function ThumbnailStrip({ profilePictures, currentIndex, userName, onThumbnailClick }: ThumbnailStripProps) {
  return (
    <Stack direction="row" spacing={1} sx={thumbnailStripStyles.container}>
      {profilePictures.map((picture, index) => (
        <Box
          key={picture.id}
          sx={{
            ...thumbnailStripStyles.thumbnail,
            ...(currentIndex === index 
              ? thumbnailStripStyles.activeThumbnail 
              : thumbnailStripStyles.inactiveThumbnail)
          }}
          onClick={() => onThumbnailClick(index)}
        >
          {picture.signedUrl ? (
            <Image
              src={picture.signedUrl}
              alt={`Thumbnail ${index + 1}`}
              width={60}
              height={60}
              style={{ objectFit: 'cover' }}
              unoptimized={true}
            />
          ) : (
            <Box sx={thumbnailStripStyles.placeholderBox}>
              <Typography variant="caption">
                {getInitials(userName)}
              </Typography>
            </Box>
          )}
        </Box>
      ))}
    </Stack>
  );
}


function OverlayDialog({
  open,
  onClose,
  onPrevious,
  onNext,
  currentPicture,
  currentIndex,
  profilePictures,
  userName,
  onThumbnailClick,
  onSetPrimary,
  onDelete,
  isOwnProfile
}: OverlayDialogProps) {
  const [actionLoading, setActionLoading] = useState<'primary' | 'delete' | null>(null);

  const handleSetPrimary = async () => {
    if (!currentPicture?.id || !onSetPrimary || currentPicture.isPrimary) return;
    setActionLoading('primary');
    try {
      await onSetPrimary(currentPicture.id);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!currentPicture?.id || !onDelete || profilePictures.length <= 1) return;
    setActionLoading('delete');
    try {
      await onDelete(currentPicture.id);
      // Move to previous image if we deleted the last one
      if (currentIndex >= profilePictures.length - 1) {
        onThumbnailClick(Math.max(0, currentIndex - 1));
      }
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      sx={overlayDialogStyles.dialog}
    >
      <DialogContent sx={overlayDialogStyles.dialogContent}>
        {/* Action Buttons (only show for own profile) */}
        {isOwnProfile && onSetPrimary && onDelete && (
          <Box sx={overlayDialogStyles.actionButtons}>
            <IconButton
              onClick={() => void handleSetPrimary()}
              disabled={currentPicture?.isPrimary || actionLoading === 'primary'}
              sx={{
                color: 'white',
                bgcolor: currentPicture?.isPrimary ? 'rgba(255, 215, 0, 0.3)' : 'rgba(0, 0, 0, 0.5)',
                '&:hover': {
                  bgcolor: currentPicture?.isPrimary ? 'rgba(255, 215, 0, 0.4)' : 'rgba(0, 0, 0, 0.7)'
                },
                '&:disabled': {
                  color: 'rgba(255, 255, 255, 0.3)',
                  bgcolor: 'rgba(0, 0, 0, 0.3)'
                }
              }}
              title={currentPicture?.isPrimary ? 'Primary Photo' : 'Set as Primary'}
            >
              {currentPicture?.isPrimary ? <Star /> : <StarBorder />}
            </IconButton>

            <IconButton
              onClick={() => void handleDelete()}
              disabled={profilePictures.length <= 1 || actionLoading === 'delete'}
              sx={{
                color: 'white',
                bgcolor: 'rgba(0, 0, 0, 0.5)',
                '&:hover': {
                  bgcolor: 'rgba(211, 47, 47, 0.7)'
                },
                '&:disabled': {
                  color: 'rgba(255, 255, 255, 0.3)',
                  bgcolor: 'rgba(0, 0, 0, 0.3)'
                }
              }}
              title="Delete Photo"
            >
              <Delete />
            </IconButton>
          </Box>
        )}

        <NavigationButtons onClose={onClose} onPrevious={onPrevious} onNext={onNext} />
        
        <MainImage currentPicture={currentPicture} currentIndex={currentIndex} userName={userName} open={open} />

        {/* Image Counter */}
        <Paper elevation={3} sx={overlayDialogStyles.imageCounter}>
          <Typography variant="body2">
            {currentIndex + 1} of {profilePictures.length}
          </Typography>
        </Paper>

        <ThumbnailStrip 
          profilePictures={profilePictures} 
          currentIndex={currentIndex} 
          userName={userName} 
          onThumbnailClick={onThumbnailClick} 
        />
      </DialogContent>
    </Dialog>
  );
}


export default function PhotoGallery({ 
  profilePictures, 
  userName,
  onSetPrimary,
  onDelete,
  isOwnProfile 
}: PhotoGalleryProps) {
  const [open, setOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleImageClick = (index: number) => {
    setCurrentIndex(index);
    setOpen(true);
  };

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleNext = useCallback(() => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % profilePictures.length);
  }, [profilePictures.length]);

  const handlePrevious = useCallback(() => {
    setCurrentIndex((prevIndex) => 
      prevIndex === 0 ? profilePictures.length - 1 : prevIndex - 1
    );
  }, [profilePictures.length]);

  // Add global keyboard event listener
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (!open) return;
      
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleNext();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handlePrevious();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    };

    if (open) {
      document.addEventListener('keydown', handleGlobalKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [open, handleNext, handlePrevious, handleClose]);

  // Only show gallery if more than 1 picture
  if (profilePictures.length <= 1) {
    return null;
  }

  const currentPicture = profilePictures[currentIndex];

  return (
    <Box>
      <Typography variant="h6" component="h2" gutterBottom sx={photoGalleryStyles.title}>
        Photo Gallery
      </Typography>
      
      <PhotoGrid 
        profilePictures={profilePictures} 
        userName={userName} 
        onImageClick={handleImageClick} 
      />

      <OverlayDialog
        open={open}
        onClose={handleClose}
        onPrevious={handlePrevious}
        onNext={handleNext}
        currentPicture={currentPicture}
        currentIndex={currentIndex}
        profilePictures={profilePictures}
        userName={userName}
        onThumbnailClick={setCurrentIndex}
        onSetPrimary={onSetPrimary}
        onDelete={onDelete}
        isOwnProfile={isOwnProfile}
      />
    </Box>
  );
}