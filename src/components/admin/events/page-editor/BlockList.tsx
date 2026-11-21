"use client";

import { useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Box, Button, Collapse, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { ArrowDownward, ArrowUpward, ContentCopy, Delete, DragIndicator, ExpandLess, ExpandMore } from "@mui/icons-material";
import type { PageBlock } from "@/types/schemas/event/page";
import BlockFields, { Thumb, UploadButton, type EditorEnv } from "./BlockFields";
import { BLOCK_LABELS, LEAF_TYPES, createBlock, newId } from "./blocks";

type Props = { blocks: PageBlock[]; onChange: (blocks: PageBlock[]) => void; env: EditorEnv; allowSections?: boolean; max?: number; label: string };

function withNewIds(block: PageBlock): PageBlock {
  return block.type === "section"
    ? { ...block, id: newId(), columns: block.columns.map(column => column.map(child => ({ ...child, id: newId() }))) }
    : { ...block, id: newId() };
}

function SectionFields({ block, onChange, env }: { block: Extract<PageBlock, { type: "section" }>; onChange: (block: PageBlock) => void; env: EditorEnv }) {
  return <Stack spacing={2}>
    <Stack direction="row" flexWrap="wrap" gap={1}>
      <TextField select size="small" label="Columns" value={block.columns.length} onChange={event => {
        const count = Number(event.target.value);
        const columns = block.columns.slice(0, count);
        // Children of removed columns move into the last remaining column instead of being lost.
        if (count < block.columns.length) columns[count - 1] = [...columns[count - 1], ...block.columns.slice(count).flat()];
        while (columns.length < count) columns.push([]);
        onChange({ ...block, columns });
      }}>{[1, 2, 3].map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}</TextField>
      <TextField select size="small" label="Padding" value={block.padding} onChange={event => onChange({ ...block, padding: event.target.value as "sm" | "md" | "lg" })}>
        <MenuItem value="sm">Small</MenuItem><MenuItem value="md">Medium</MenuItem><MenuItem value="lg">Large</MenuItem>
      </TextField>
      {(["background", "foreground"] as const).map(key => <Stack key={key} direction="row" alignItems="center">
        <TextField size="small" type="color" label={key === "background" ? "Background" : "Text color"} value={block[key] || (key === "background" ? "#ffffff" : "#202020")}
          onChange={event => onChange({ ...block, [key]: event.target.value })} sx={{ width: 130 }} />
        {block[key] && <Button size="small" onClick={() => onChange({ ...block, [key]: undefined })}>Reset</Button>}
      </Stack>)}
    </Stack>
    <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
      <Thumb url={block.backgroundImage} />
      {/* Backgrounds use the still image: CSS backgrounds cannot honour reduced motion. */}
      <UploadButton env={env} label={block.backgroundImage ? "Replace background image" : "Upload background image (optional)"}
        onUploaded={data => onChange({ ...block, backgroundImage: data.posterUrl || data.url })} />
      {block.backgroundImage && <Button size="small" onClick={() => onChange({ ...block, backgroundImage: undefined })}>Remove background image</Button>}
    </Stack>
    {block.columns.map((column, index) => <Box key={`${block.id}-col-${index}`} sx={{ borderLeft: 3, borderColor: "primary.main", pl: 2 }}>
      <BlockList label={`Column ${index + 1}`} blocks={column} env={env} max={20}
        onChange={children => onChange({ ...block, columns: block.columns.map((current, i) => i === index ? children as typeof column : current) })} />
    </Box>)}
  </Stack>;
}

function BlockItem({ block, index, count, env, onChange, onMove, onRemove, onDuplicate }: {
  block: PageBlock; index: number; count: number; env: EditorEnv;
  onChange: (block: PageBlock) => void; onMove: (delta: number) => void; onRemove: () => void; onDuplicate: () => void;
}) {
  const [open, setOpen] = useState(true);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const name = `${index + 1}. ${BLOCK_LABELS[block.type]}`;
  return <Paper ref={setNodeRef} variant="outlined" style={{ transform: CSS.Transform.toString(transform), transition, position: "relative", zIndex: isDragging ? 2 : 0 }} sx={{ p: 1.5 }}>
    <Stack direction="row" alignItems="center" gap={0.5} flexWrap="wrap">
      <IconButton ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag ${name}`} size="small" sx={{ cursor: "grab" }}><DragIndicator /></IconButton>
      <Typography component="h4" variant="subtitle2" sx={{ flex: 1, minWidth: 120 }}>{name}</Typography>
      <Tooltip title="Move up"><span><IconButton size="small" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUpward fontSize="small" /></IconButton></span></Tooltip>
      <Tooltip title="Move down"><span><IconButton size="small" aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDownward fontSize="small" /></IconButton></span></Tooltip>
      <Tooltip title="Duplicate"><IconButton size="small" aria-label={`Duplicate ${name}`} onClick={onDuplicate}><ContentCopy fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="Remove"><IconButton size="small" aria-label={`Remove ${name}`} onClick={onRemove}><Delete fontSize="small" /></IconButton></Tooltip>
      <IconButton size="small" aria-label={open ? `Collapse ${name}` : `Expand ${name}`} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <ExpandLess /> : <ExpandMore />}</IconButton>
    </Stack>
    <Collapse in={open} unmountOnExit>
      <Stack spacing={1.5} sx={{ pt: 1.5 }}>
        {block.type === "section" ? <SectionFields block={block} onChange={onChange} env={env} /> : <BlockFields block={block} onChange={onChange} env={env} />}
        <TextField size="small" label="CSS class (optional)" helperText={`Style it with .${block.cssClass || "your-class"} or .vp-block-${block.type} in Custom CSS`}
          value={block.cssClass || ""} onChange={event => onChange({ ...block, cssClass: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") || undefined })} sx={{ maxWidth: 360 }} />
      </Stack>
    </Collapse>
  </Paper>;
}

/** Sortable list of page elements; sections nest one level of columns. */
export default function BlockList({ blocks, onChange, env, allowSections = false, max = 60, label }: Props) {
  const [newType, setNewType] = useState<PageBlock["type"]>("text");
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const types = allowSections ? [...LEAF_TYPES, "section" as const] : LEAF_TYPES;
  const set = (index: number, block: PageBlock) => onChange(blocks.map((current, i) => i === index ? block : current));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onChange(arrayMove(blocks, blocks.findIndex(b => b.id === active.id), blocks.findIndex(b => b.id === over.id)));
  };
  return <Stack spacing={1.5} aria-label={label} role="group">
    {blocks.length === 0 && <Typography variant="body2" color="text.secondary">{label}: no elements yet.</Typography>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
        {blocks.map((block, index) => <BlockItem key={block.id} block={block} index={index} count={blocks.length} env={env}
          onChange={updated => set(index, updated)}
          onMove={delta => onChange(arrayMove(blocks, index, index + delta))}
          onRemove={() => onChange(blocks.filter(item => item.id !== block.id))}
          onDuplicate={() => onChange([...blocks.slice(0, index + 1), withNewIds(block), ...blocks.slice(index + 1)])} />)}
      </SortableContext>
    </DndContext>
    <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
      <TextField select size="small" label="New element" value={newType} onChange={event => setNewType(event.target.value as PageBlock["type"])} sx={{ minWidth: 220 }}>
        {types.map(type => <MenuItem key={type} value={type}>{BLOCK_LABELS[type]}</MenuItem>)}
      </TextField>
      <Button variant="outlined" disabled={blocks.length >= max} onClick={() => onChange([...blocks, createBlock(newType, env.pages[0]?.slug || "home")])}>Add to {label.toLowerCase()}</Button>
    </Stack>
  </Stack>;
}
