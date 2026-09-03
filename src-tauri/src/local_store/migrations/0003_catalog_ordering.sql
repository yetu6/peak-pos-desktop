ALTER TABLE catalog_snapshots ADD COLUMN property_id TEXT;
ALTER TABLE catalog_snapshots ADD COLUMN outlet_id TEXT;
ALTER TABLE catalog_snapshots ADD COLUMN not_before_ms INTEGER;
ALTER TABLE catalog_snapshots ADD COLUMN tax_mode TEXT CHECK (tax_mode IN ('EXCLUSIVE','INCLUSIVE'));

CREATE TABLE catalog_service_types (
  snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(snapshot_id) ON DELETE RESTRICT,
  service_type TEXT NOT NULL,
  label TEXT NOT NULL,
  requires_context INTEGER NOT NULL CHECK (requires_context IN (0,1)),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  PRIMARY KEY (snapshot_id, service_type),
  UNIQUE (snapshot_id, sort_order)
) STRICT;

CREATE TABLE catalog_categories (
  snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(snapshot_id) ON DELETE RESTRICT,
  category_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  is_active INTEGER NOT NULL CHECK (is_active IN (0,1)),
  PRIMARY KEY (snapshot_id, category_id),
  UNIQUE (snapshot_id, code),
  UNIQUE (snapshot_id, sort_order)
) STRICT;

CREATE TABLE catalog_products (
  snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(snapshot_id) ON DELETE RESTRICT,
  product_id TEXT NOT NULL,
  category_id TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_search TEXT NOT NULL,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  tax_rate_bp INTEGER NOT NULL CHECK (tax_rate_bp >= 0 AND tax_rate_bp <= 100000),
  is_available INTEGER NOT NULL CHECK (is_available IN (0,1)),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  PRIMARY KEY (snapshot_id, product_id),
  UNIQUE (snapshot_id, code),
  UNIQUE (snapshot_id, sort_order),
  FOREIGN KEY (snapshot_id, category_id)
    REFERENCES catalog_categories(snapshot_id, category_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE catalog_modifier_groups (
  snapshot_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  min_select INTEGER NOT NULL CHECK (min_select >= 0),
  max_select INTEGER NOT NULL CHECK (max_select >= min_select),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  is_active INTEGER NOT NULL CHECK (is_active IN (0,1)),
  PRIMARY KEY (snapshot_id, group_id),
  UNIQUE (snapshot_id, product_id, sort_order),
  FOREIGN KEY (snapshot_id, product_id)
    REFERENCES catalog_products(snapshot_id, product_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE catalog_modifier_options (
  snapshot_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price_delta_minor INTEGER NOT NULL,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  is_available INTEGER NOT NULL CHECK (is_available IN (0,1)),
  PRIMARY KEY (snapshot_id, option_id),
  UNIQUE (snapshot_id, group_id, sort_order),
  FOREIGN KEY (snapshot_id, group_id)
    REFERENCES catalog_modifier_groups(snapshot_id, group_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_catalog_products_search
ON catalog_products(snapshot_id, normalized_search);
CREATE INDEX idx_catalog_products_category
ON catalog_products(snapshot_id, category_id, sort_order);

ALTER TABLE orders ADD COLUMN staff_id TEXT;
ALTER TABLE orders ADD COLUMN table_label TEXT;
ALTER TABLE orders ADD COLUMN notes TEXT;
ALTER TABLE orders ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE orders ADD COLUMN order_number TEXT;
ALTER TABLE orders ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'LOCAL_DRAFT'
  CHECK (sync_state IN ('LOCAL_DRAFT','SYNC_PENDING','ACKNOWLEDGED','MANUAL_REVIEW'));

CREATE TRIGGER immutable_committed_order_context_update
BEFORE UPDATE OF staff_id,table_label,notes,order_number
ON orders WHEN OLD.immutable_committed = 1 BEGIN
  SELECT RAISE(ABORT, 'immutable committed order context');
END;

CREATE TRIGGER immutable_catalog_service_types_update BEFORE UPDATE ON catalog_service_types BEGIN
  SELECT RAISE(ABORT, 'immutable catalog projection');
END;
CREATE TRIGGER immutable_catalog_service_types_delete BEFORE DELETE ON catalog_service_types BEGIN
  SELECT RAISE(ABORT, 'immutable catalog projection');
END;
CREATE TRIGGER immutable_catalog_categories_update BEFORE UPDATE ON catalog_categories BEGIN
  SELECT RAISE(ABORT, 'immutable catalog projection');
END;
CREATE TRIGGER immutable_catalog_categories_delete BEFORE DELETE ON catalog_categories BEGIN
  SELECT RAISE(ABORT, 'immutable catalog projection');
END;
CREATE TRIGGER immutable_catalog_products_update BEFORE UPDATE ON catalog_products BEGIN
  SELECT RAISE(ABORT, 'immutable catalog projection');
END;
CREATE TRIGGER immutable_catalog_products_delete BEFORE DELETE ON catalog_products BEGIN
  SELECT RAISE(ABORT, 'immutable catalog projection');
END;
CREATE TRIGGER immutable_catalog_modifier_groups_update BEFORE UPDATE ON catalog_modifier_groups BEGIN
  SELECT RAISE(ABORT, 'immutable catalog projection');
END;
CREATE TRIGGER immutable_catalog_modifier_groups_delete BEFORE DELETE ON catalog_modifier_groups BEGIN
  SELECT RAISE(ABORT, 'immutable catalog projection');
END;
CREATE TRIGGER immutable_catalog_modifier_options_update BEFORE UPDATE ON catalog_modifier_options BEGIN
  SELECT RAISE(ABORT, 'immutable catalog projection');
END;
CREATE TRIGGER immutable_catalog_modifier_options_delete BEFORE DELETE ON catalog_modifier_options BEGIN
  SELECT RAISE(ABORT, 'immutable catalog projection');
END;

CREATE TRIGGER immutable_catalog_snapshot_update
BEFORE UPDATE OF snapshot_id,version,digest,currency,published_at_ms,valid_until_ms,
  signed_manifest,payload,verification_state,property_id,outlet_id,not_before_ms,tax_mode
ON catalog_snapshots WHEN OLD.verification_state='VERIFIED' BEGIN
  SELECT RAISE(ABORT, 'immutable verified catalog snapshot');
END;
CREATE TRIGGER immutable_catalog_snapshot_delete
BEFORE DELETE ON catalog_snapshots BEGIN
  SELECT RAISE(ABORT, 'catalog retention requires explicit compaction protocol');
END;
