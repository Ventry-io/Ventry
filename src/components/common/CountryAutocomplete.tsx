"use client";

import type { ReactNode } from "react";
import {
  Autocomplete,
  Box,
  TextField,
  createFilterOptions,
} from "@mui/material";
import {
  COUNTRIES,
  getCountryByCode,
  getCountryFlag,
  type Country,
} from "@/lib/countries";

const filterOptions = createFilterOptions<Country>({
  stringify: (country) => `${country.name} ${country.code}`,
});

interface CountryAutocompleteProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  helperText?: ReactNode;
  required?: boolean;
  fullWidth?: boolean;
  margin?: "none" | "dense" | "normal";
}

export default function CountryAutocomplete({
  label = "Country",
  value,
  onChange,
  error = false,
  helperText = " ",
  required = false,
  fullWidth = true,
  margin = "none",
}: CountryAutocompleteProps) {
  const selectedCountry = value ? getCountryByCode(value) ?? null : null;

  return (
    <Autocomplete
      autoHighlight
      clearOnEscape={!required}
      filterOptions={filterOptions}
      fullWidth={fullWidth}
      getOptionLabel={(option) => option.name}
      isOptionEqualToValue={(option, selected) => option.code === selected.code}
      onChange={(_, country) => onChange(country?.code ?? "")}
      options={COUNTRIES}
      selectOnFocus
      value={selectedCountry}
      renderOption={({ key, ...props }, country) => (
        <Box key={key} component="li" {...props}>
          <Box component="span" sx={{ mr: 1, width: 24, flexShrink: 0 }}>
            {getCountryFlag(country.code)}
          </Box>
          {country.name}
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          error={error}
          helperText={helperText}
          inputProps={{
            ...params.inputProps,
            autoComplete: "country-name",
          }}
          label={label}
          margin={margin}
          required={required}
        />
      )}
    />
  );
}
