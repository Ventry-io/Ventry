"use client";

import type React from "react";
import { useMemo, useEffect } from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';
import zxcvbn from 'zxcvbn';

const EMPTY_INPUTS: string[] = [];

interface PasswordStrengthMeterProps {
  password: string;
  setWarning: React.Dispatch<React.SetStateAction<{ message: string | null; suggestions: string[] } | null>>;
  userInputs?: string[];
}

export default function PasswordStrengthMeter({ 
  password, 
  userInputs = EMPTY_INPUTS,
  setWarning
}: PasswordStrengthMeterProps) {
  // const [result, setResult] = useState<any>(null);
  const result = useMemo(() => {
    if(!password) return null;
    return zxcvbn(password, userInputs);
  }, [password, userInputs]);

  // Update warning in useEffect to avoid state updates during render
  useEffect(() => {
    if (result && result.score < 3) {
      setWarning({ message: result.feedback.warning || "Choose a longer, less predictable password.", suggestions: result.feedback.suggestions });
    } else {
      setWarning(null);
    }
  }, [result, setWarning]);


  if (!password || !result) {
    return null;
  }

  // Colors for different strength levels
  const colors = ['#f44336', '#ff9800', '#ffeb3b', '#4caf50', '#2196f3'];
  
  // Progress value (0-100)
  const normalizedScore = ((result.score + 1) / 5) * 100;
  
  // Strength text
  const strengthText = [
    'Very Weak',
    'Weak',
    'Fair',
    'Good',
    'Strong'
  ][result.score] || 'Unknown';

  return (
    <Box sx={{ mt: 2, mb: 2 }}>
      <LinearProgress
        aria-label="Password strength"
        variant="determinate"
        value={normalizedScore}
        sx={{
          height: 10,
          borderRadius: 5,
          backgroundColor: '#e0e0e0',
          '& .MuiLinearProgress-bar': {
            backgroundColor: colors[result.score],
          }
        }}
      />
      
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
        <Typography variant="body2" color={colors[result.score]}>
          {strengthText}
        </Typography>
        
        {result.score < 3 && (
          <Typography variant="body2" color="text.secondary">
            {result.feedback.warning || "Use a longer, less predictable password to continue."}
          </Typography>
        )}
      </Box>

      <PasswordFeedback suggestions={result.feedback.suggestions} />
    </Box>
  );
}

function PasswordFeedback({ suggestions }: { suggestions: string[] }) {
  if (suggestions.length === 0) return null;

  return <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Suggestions:
          </Typography>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {suggestions.map((suggestion: string) => (
              <li key={`suggestion-${suggestion}`}>
                <Typography variant="caption" color="text.secondary">
                  {suggestion}
                </Typography>
              </li>
            ))}
          </ul>
        </Box>
}
