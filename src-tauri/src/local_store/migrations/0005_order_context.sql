-- Advisory order context; financial evidence and completed transactions stay immutable.
ALTER TABLE orders ADD COLUMN guest_count INTEGER CHECK (guest_count > 0 AND guest_count <= 2147483647);
ALTER TABLE orders ADD COLUMN ask_for_table INTEGER CHECK (ask_for_table IN (0, 1));

CREATE TRIGGER immutable_committed_order_optional_context_update
BEFORE UPDATE OF guest_count,ask_for_table ON orders
WHEN OLD.immutable_committed = 1 BEGIN
  SELECT RAISE(ABORT, 'immutable committed order context');
END;
