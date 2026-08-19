-- For PR418H, PR419H, PR682H, PR683H, the Aircraft and Livery values were
-- swapped in the source spreadsheet (aircraft_types held "Philippine
-- Airlines", liveries held the actual aircraft type) -- this is what made
-- "Philippine Airlines" incorrectly show up in the Route DB's aircraft
-- filter dropdown. Swapping the two arrays back for just these rows.
update routes
set aircraft_types = liveries, liveries = aircraft_types
where flight_number in ('PR418H', 'PR419H', 'PR682H', 'PR683H');
