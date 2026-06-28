-- ============================================================================
-- REAL ESTATE ENGINE v2 — CANONICAL SCHEMA (Phase 1: Foundation)
-- ----------------------------------------------------------------------------
-- One canonical table for ALL portals. We KEEP EVERYTHING (even out-of-scope
-- listings) because all data feeds the price-estimation model (AVM).
-- Scope focus: byty <= 90 m2 + bytové domy / multi-unit buildings, whole
-- Středočeský kraj. Filtering happens at EVALUATION time, never at ingest.
--
-- Apply this in the Supabase SQL editor. It is ADDITIVE: it does not drop the
-- existing listings_<portal> tables, so nothing breaks during the migration.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CANONICAL PROPERTIES TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS properties (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- === SOURCE / IDENTITY ===
    portal        TEXT NOT NULL,                       -- 'bazos','annonce','avizo','hyperinzerce',...
    external_id   TEXT,                                -- portal's own id
    url           TEXT UNIQUE,                         -- dedupe key within a portal
    source_type   TEXT DEFAULT 'scraped',             -- 'scraped' | 'feed' (bazos external feed) | 'manual'

    -- === LISTING CONTENT ===
    title         TEXT,
    description   TEXT,
    price_raw     TEXT,
    price_numeric BIGINT,
    currency      TEXT DEFAULT 'CZK',

    -- === LOCATION (raw + normalized for AVM cohorts) ===
    location_raw  TEXT,                                -- whatever the portal gave us
    region        TEXT,                                -- kraj, e.g. 'Středočeský'
    district      TEXT,                                -- okres, e.g. 'Praha-východ', 'Kladno'
    municipality  TEXT,                                -- obec / město
    city_part     TEXT,                                -- městská část (Praha) where relevant
    street        TEXT,
    location_zip  TEXT,
    lat           DOUBLE PRECISION,
    lng           DOUBLE PRECISION,

    -- === PROPERTY ATTRIBUTES ===
    property_type TEXT,                                -- 'byt' | 'bytovy_dum' | 'other'
    disposition   TEXT,                                -- '2+kk', '3+1', ...
    area_m2       NUMERIC,
    land_m2       NUMERIC,
    rooms         INT,
    floor         TEXT,
    ownership     TEXT,                                -- 'Osobní', 'Družstevní', ...
    condition     TEXT,                                -- 'novostavba'|'po rekonstrukci'|'před rekonstrukcí'|'dobrý'|null
    num_units     INT,                                 -- bytové domy: počet bytových jednotek
    price_per_m2  NUMERIC,                             -- computed at ingest/eval

    -- === MEDIA & CONTACT ===
    images        JSONB DEFAULT '[]'::jsonb,
    contact_name  TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    is_agent      BOOLEAN DEFAULT FALSE,               -- broker detection result

    -- === LIFECYCLE / HISTORY (keep everything) ===
    first_seen_at TIMESTAMPTZ DEFAULT now(),
    last_seen_at  TIMESTAMPTZ DEFAULT now(),
    is_active     BOOLEAN DEFAULT TRUE,
    delisted_at   TIMESTAMPTZ,                         -- set when it disappears from the portal
    price_history JSONB DEFAULT '[]'::jsonb,           -- [{price, date}, ...]
    price_drop_count INT DEFAULT 0,
    price_drop_total_pct NUMERIC DEFAULT 0,
    relist_count  INT DEFAULT 0,                       -- re-appeared after delisting = motivation signal

    -- === VALUATION (AVM, Phase 3) ===
    estimated_value        BIGINT,                     -- our own price estimate
    estimated_value_per_m2 NUMERIC,
    valuation_confidence   NUMERIC,                    -- 0..1, depends on cohort sample size
    discount_vs_estimate_pct NUMERIC,                  -- (estimate - price) / estimate * 100
    arv_estimate           BIGINT,                     -- after-repair value (flip)
    renovation_estimate    BIGINT,                     -- estimated reno cost
    expected_margin_pct    NUMERIC,                    -- flip margin

    -- === LEAD SCORING (Phase 4) ===
    distress_factors  JSONB DEFAULT '[]'::jsonb,       -- ['dědictví','spěchá',...]
    lead_score        NUMERIC,                         -- real distribution, NO artificial floor
    lead_tier         TEXT,                            -- 'A' | 'B' | 'C' | null
    eval_status       TEXT DEFAULT 'pending',          -- 'pending'|'evaluated'|'rejected'
    reject_reason     TEXT,
    notes             TEXT,                            -- human/AI summary
    raw_data          JSONB DEFAULT '{}'::jsonb,       -- portal-specific extras for debugging

    -- === CRM HANDOFF (Phase 6) — sent only after approval ===
    approved          BOOLEAN DEFAULT FALSE,           -- vetted on dashboard
    sent_to_crm       BOOLEAN DEFAULT FALSE,
    sent_to_crm_at    TIMESTAMPTZ,
    crm_contact_id    TEXT,

    -- === TIMESTAMPS ===
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    evaluated_at  TIMESTAMPTZ,

    UNIQUE (portal, external_id)
);

-- ----------------------------------------------------------------------------
-- 2. PRICE HISTORY TRIGGER — append old price to price_history on change,
--    and maintain price-drop counters (motivation signals).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION properties_track_price()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.price_numeric IS DISTINCT FROM NEW.price_numeric)
       AND OLD.price_numeric IS NOT NULL THEN
        NEW.price_history = COALESCE(OLD.price_history, '[]'::jsonb) ||
            jsonb_build_object('price', OLD.price_numeric, 'date', OLD.last_seen_at);

        IF NEW.price_numeric < OLD.price_numeric THEN
            NEW.price_drop_count = COALESCE(OLD.price_drop_count, 0) + 1;
            NEW.price_drop_total_pct = ROUND(
                ((OLD.price_numeric - NEW.price_numeric)::numeric
                 / NULLIF(OLD.price_numeric, 0)) * 100, 1
            ) + COALESCE(OLD.price_drop_total_pct, 0);
        END IF;
    END IF;

    -- keep price_per_m2 in sync
    IF NEW.price_numeric IS NOT NULL AND NEW.area_m2 IS NOT NULL AND NEW.area_m2 > 0 THEN
        NEW.price_per_m2 = ROUND(NEW.price_numeric::numeric / NEW.area_m2);
    END IF;

    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_properties_price ON properties;
CREATE TRIGGER trg_properties_price
    BEFORE UPDATE ON properties
    FOR EACH ROW EXECUTE FUNCTION properties_track_price();

-- ----------------------------------------------------------------------------
-- 3. INDEXES — for AVM cohort queries, dashboard filtering, and dedup.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_prop_portal_extid   ON properties(portal, external_id);
CREATE INDEX IF NOT EXISTS idx_prop_active          ON properties(is_active);
CREATE INDEX IF NOT EXISTS idx_prop_eval_status     ON properties(eval_status);
CREATE INDEX IF NOT EXISTS idx_prop_lead_tier       ON properties(lead_tier);
CREATE INDEX IF NOT EXISTS idx_prop_type            ON properties(property_type);
CREATE INDEX IF NOT EXISTS idx_prop_cohort          ON properties(district, disposition, property_type);
CREATE INDEX IF NOT EXISTS idx_prop_phone           ON properties(contact_phone);
CREATE INDEX IF NOT EXISTS idx_prop_price_per_m2    ON properties(price_per_m2);

-- ----------------------------------------------------------------------------
-- 4. CONTACTS (broker detection) — keep the existing global contacts table.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         TEXT UNIQUE,
    email         TEXT UNIQUE,
    name          TEXT,
    listing_count INT DEFAULT 1,
    is_broker     BOOLEAN DEFAULT FALSE,
    first_seen    TIMESTAMPTZ DEFAULT now(),
    last_seen     TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 5. AVM COHORT BENCHMARKS — median price/m² per (district, disposition,
--    property_type). Refreshed periodically from `properties`. This is the
--    ground truth the deal-detection compares against (Phase 3).
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS avm_benchmarks AS
SELECT
    district,
    disposition,
    property_type,
    COUNT(*)                              AS sample_size,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_per_m2)) AS median_price_per_m2,
    ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY price_per_m2)) AS p25_price_per_m2,
    ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY price_per_m2)) AS p75_price_per_m2
FROM properties
WHERE price_per_m2 IS NOT NULL
  AND price_per_m2 BETWEEN 10000 AND 400000   -- guard against garbage values
  AND is_active = TRUE
GROUP BY district, disposition, property_type;

CREATE INDEX IF NOT EXISTS idx_avm_cohort
    ON avm_benchmarks(district, disposition, property_type);

-- Refresh with:  REFRESH MATERIALIZED VIEW avm_benchmarks;

-- ----------------------------------------------------------------------------
-- 6. RLS off (write via anon/service key, same as the existing tables).
-- ----------------------------------------------------------------------------
ALTER TABLE properties DISABLE ROW LEVEL SECURITY;
ALTER TABLE contacts   DISABLE ROW LEVEL SECURITY;
