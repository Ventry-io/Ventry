"use client";

import { Autocomplete, Button, Chip, MenuItem, Stack, TextField } from "@mui/material";
import { matchesBadgeConditions, type BadgeAttendee } from "@/lib/badges/badge";
import type { BadgeCondition } from "@/types/schemas/badge";

const OPERATORS = {
  equals: "equals", notEquals: "does not equal", contains: "contains",
  greaterThan: "is greater than", lessThan: "is less than",
  isEmpty: "is empty", isNotEmpty: "is not empty",
};

export default function BadgeConditions({ conditions, onChange, fields, attendee }: {
  conditions: BadgeCondition[];
  onChange: (conditions: BadgeCondition[]) => void;
  fields: string[];
  attendee: BadgeAttendee | null;
}) {
  const update = (index: number, patch: Partial<BadgeCondition>) =>
    onChange(conditions.map((condition, position) => position === index ? { ...condition, ...patch } : condition));
  return <Stack spacing={1}>
    {conditions.map((condition, index) => <Stack key={index} spacing={1} sx={{ borderLeft: "2px solid", borderColor: "primary.main", pl: 1 }}>
      <Autocomplete freeSolo options={fields} inputValue={condition.field}
        onInputChange={(_, field) => update(index, { field })}
        renderInput={params => <TextField {...params} label="Data field" size="small" placeholder="customFieldData.role" />} />
      <TextField select size="small" label="Comparison" value={condition.operator}
        onChange={event => update(index, { operator: event.target.value as BadgeCondition["operator"] })}>
        {Object.entries(OPERATORS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
      </TextField>
      {!["isEmpty", "isNotEmpty"].includes(condition.operator) ? <TextField size="small" label="Value" value={condition.value}
        onChange={event => update(index, { value: event.target.value })} /> : null}
      <Button size="small" color="error" onClick={() => onChange(conditions.filter((_, position) => position !== index))}>Remove condition {index + 1}</Button>
    </Stack>)}
    {conditions.length < 10 ? <Button size="small" onClick={() => onChange([...conditions, { field: "ticketTier", operator: "equals", value: "Sponsor" }])}>
      {conditions.length ? "Add AND condition" : "Add condition"}
    </Button> : null}
    {attendee && conditions.length ? <Chip size="small" color={matchesBadgeConditions(conditions, attendee) ? "success" : "default"}
      label={matchesBadgeConditions(conditions, attendee) ? "Matches sample attendee" : "Does not match sample"} /> : null}
  </Stack>;
}
