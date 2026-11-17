import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Paper, IconButton, Grid, TextField, Box } from '@mui/material';
import { Delete, DragIndicator } from '@mui/icons-material';

export interface SortableDraftProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  capacity: number | null;
  minOccupants?: number;
  maxOccupants?: number;
}

interface SortableProductItemProps {
  id: string;
  product: SortableDraftProduct;
  nameLabel: string;
  priceLabel?: string;
  descriptionLabel?: string;
  capacityLabel?: string;
  removeDisabled?: boolean;
  /** Room types: persons per physical room */
  showOccupancy?: boolean;
  onChange: (field: keyof SortableDraftProduct, value: string | number | null) => void;
  onRemove: () => void;
}

export function SortableProductItem({
  id,
  product,
  nameLabel,
  priceLabel = 'Price',
  descriptionLabel = 'Description',
  capacityLabel = 'Capacity',
  removeDisabled = false,
  showOccupancy = false,
  onChange,
  onRemove,
}: SortableProductItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
    position: 'relative' as const,
  };

  return (
    <Paper
      ref={setNodeRef}
      style={style}
      variant="outlined"
      sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'flex-start', bgcolor: 'background.paper' }}
    >
      <Box
        {...attributes}
        {...listeners}
        sx={{
          cursor: 'grab',
          mt: 1,
          color: 'text.secondary',
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicator />
      </Box>

      <Box sx={{ flexGrow: 1 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              label={nameLabel}
              value={product.name}
              onChange={(event) => onChange('name', event.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField
              fullWidth
              type="number"
              label={priceLabel}
              value={product.price}
              onChange={(event) => onChange('price', event.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField
              fullWidth
              type="number"
              label={capacityLabel}
              placeholder="Unlimited"
              value={product.capacity ?? ''}
              onChange={(event) => onChange('capacity', event.target.value === '' ? null : event.target.value)}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <IconButton color="error" onClick={onRemove} disabled={removeDisabled}>
                <Delete />
              </IconButton>
            </Box>
          </Grid>
          {showOccupancy && (
            <>
              <Grid size={{ xs: 6, md: 3 }}>
                <TextField
                  fullWidth
                  type="number"
                  label="Min. persons per room"
                  slotProps={{ htmlInput: { min: 1, max: 20 } }}
                  value={product.minOccupants ?? 1}
                  onChange={(event) => onChange('minOccupants', event.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <TextField
                  fullWidth
                  type="number"
                  label="Max. persons per room"
                  slotProps={{ htmlInput: { min: 1, max: 20 } }}
                  value={product.maxOccupants ?? 1}
                  onChange={(event) => onChange('maxOccupants', event.target.value)}
                />
              </Grid>
            </>
          )}
          <Grid size={{ xs: 12 }}>
            <TextField
              fullWidth
              multiline
              rows={2}
              label={descriptionLabel}
              value={product.description}
              onChange={(event) => onChange('description', event.target.value)}
            />
          </Grid>
        </Grid>
      </Box>
    </Paper>
  );
}
