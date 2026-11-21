type TicketProduct = { type?: string; price?: number | null };

export function ticketPriceLabel(products: TicketProduct[], locale = "de"): string | null {
  const tickets = products.filter(product => product.type === "TICKET");
  if (!tickets.length || tickets.some(ticket => typeof ticket.price !== "number" || !Number.isFinite(ticket.price) || ticket.price < 0)) return null;
  const prices = tickets.map(ticket => ticket.price as number);
  if (prices.every(price => price === 0)) return locale.startsWith("de") ? "Das Event ist free" : "This event is free";
  const format = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? format.format(min) : `${format.format(min)} – ${format.format(max)}`;
}
