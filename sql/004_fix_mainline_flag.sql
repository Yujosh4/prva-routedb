-- The "Create Airline" import-tool flow had no way to mark an airline as
-- mainline, so Philippine Airlines defaulted to is_mainline = false,
-- making every route show an incorrect codeshare badge. Fixing the
-- existing row here; the import tool itself is also being updated so this
-- doesn't happen again for future airlines.
update airlines set is_mainline = true where name = 'Philippine Airlines';
