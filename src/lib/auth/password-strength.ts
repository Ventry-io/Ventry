import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common';
import * as zxcvbnEnPackage from '@zxcvbn-ts/language-en';

/**
 * The user information type used for zxcvbn analysis.
 * This can include email, username, or any other user-specific data.
 * Example: 'Max', 'Doe', '1990'
 */
type UserInformation = string;

export interface PasswordStrengthResult {
    /** 0-4 (0 = very weak, 4 = very strong) */
  score: number;
  feedback: {
    warning: string | null;     // Warning message if weak
    suggestions: string[]; // Suggestions to improve
  };
  strengthText: string;  // Human-readable strength
  isStrong: boolean;     // Whether it meets minimum requirements
}

const STRENGTH_LABELS = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];

// Built once per module load: ranking the dictionaries is the expensive part.
const zxcvbn = new ZxcvbnFactory({
  translations: zxcvbnEnPackage.translations,
  graphs: zxcvbnCommonPackage.adjacencyGraphs,
  dictionary: {
    ...zxcvbnCommonPackage.dictionary,
    ...zxcvbnEnPackage.dictionary,
  },
});

/**
 * Analyze password strength using zxcvbn-ts
 *
 * @param password The password to analyze
 * @param userInputs Optional array of user-specific inputs to check against (email, username, etc.)
 * @param minStrength Minimum required strength (0-4)
 */
export function checkPasswordStrength(
  password: string,
  userInputs: UserInformation[] = [],
  minStrength: number = 2
): PasswordStrengthResult {
  const result = zxcvbn.check(password, userInputs);

  return {
    score: result.score,
    feedback: result.feedback,
    strengthText: STRENGTH_LABELS[result.score] || 'Unknown',
    isStrong: result.score >= minStrength
  };
}
