type Identity = {
  legalName?: string | null;
  addressLine1?: string | null;
  addressCity?: string | null;
  addressPostalCode?: string | null;
  addressCountry?: string | null;
};

export function hasCheckInIdentity(user: Identity): boolean {
  return (user.legalName?.trim().length ?? 0) >= 2;
}

export function hasBillingAddress(user: Identity): boolean {
  return [user.addressLine1, user.addressCity, user.addressPostalCode]
    .every((value) => (value?.trim().length ?? 0) >= 2)
    && user.addressCountry?.trim().length === 2;
}
