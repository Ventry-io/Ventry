-- Room types created before 20261110120000_hotel_room_allocation got maxOccupants = 1, which turned
-- every existing double room into a single room. No earlier bed count exists, so derive it from the
-- product name. Only untouched defaults are changed; organizers can correct any room type afterwards.
-- minOccupants stays 1 so existing solo bookings are not flagged as under-occupied.
UPDATE "Product"
SET "maxOccupants" = CASE
    WHEN "name" ~* '(quad|vierbett|4[ -]?(bett|bed|person))' THEN 4
    WHEN "name" ~* '(triple|dreibett|3[ -]?(bett|bed|person))' THEN 3
    WHEN "name" ~* '(double|doppel|twin|zweibett|2[ -]?(bett|bed|person))' THEN 2
    ELSE "maxOccupants"
END
WHERE "type" = 'ACCOMMODATION'
  AND "maxOccupants" = 1
  AND "minOccupants" = 1
  AND "name" ~* '(quad|vierbett|triple|dreibett|double|doppel|twin|zweibett|[234][ -]?(bett|bed|person))';
