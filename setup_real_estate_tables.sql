-- REAL ESTATE HUNTER - DATABASE SCHEMA (HIDDEN GEMS VERSION)
-- This script creates 7 tables for pure classifieds portals (NO Sreality, NO Bezrealitky, NO Sbazar).

-- 1. FUNCTION TO TRACK PRICE HISTORY
CREATE OR REPLACE FUNCTION track_price_history()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.price_numeric IS DISTINCT FROM NEW.price_numeric) THEN
    NEW.price_history = OLD.price_history || jsonb_build_object(
      'price', OLD.price_numeric,
      'date', OLD.last_checked_at
    );
  END IF;
  NEW.last_checked_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. PORTAL TABLES

-- BAZOS
CREATE TABLE IF NOT EXISTS listings_bazos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT,
  title TEXT,
  description TEXT,
  price_raw TEXT,
  price_numeric BIGINT,
  location TEXT,
  location_zip TEXT,
  url TEXT UNIQUE,
  phone TEXT,
  is_agent BOOLEAN DEFAULT false,
  images JSONB DEFAULT '[]'::jsonb,
  gem_score NUMERIC(3,1) DEFAULT 0,
  gem_notes TEXT,
  price_history JSONB DEFAULT '[]'::jsonb,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  last_checked_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb
);
DROP TRIGGER IF EXISTS trg_bazos_price_history ON listings_bazos;
CREATE TRIGGER trg_bazos_price_history BEFORE UPDATE ON listings_bazos FOR EACH ROW EXECUTE FUNCTION track_price_history();

-- ANNONCE
CREATE TABLE IF NOT EXISTS listings_annonce (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT,
  title TEXT,
  description TEXT,
  price_raw TEXT,
  price_numeric BIGINT,
  location TEXT,
  location_zip TEXT,
  url TEXT UNIQUE,
  phone TEXT,
  is_agent BOOLEAN DEFAULT false,
  images JSONB DEFAULT '[]'::jsonb,
  gem_score NUMERIC(3,1) DEFAULT 0,
  gem_notes TEXT,
  price_history JSONB DEFAULT '[]'::jsonb,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  last_checked_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb
);
DROP TRIGGER IF EXISTS trg_annonce_price_history ON listings_annonce;
CREATE TRIGGER trg_annonce_price_history BEFORE UPDATE ON listings_annonce FOR EACH ROW EXECUTE FUNCTION track_price_history();

-- AVIZO
CREATE TABLE IF NOT EXISTS listings_avizo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT,
  title TEXT,
  description TEXT,
  price_raw TEXT,
  price_numeric BIGINT,
  location TEXT,
  location_zip TEXT,
  url TEXT UNIQUE,
  phone TEXT,
  is_agent BOOLEAN DEFAULT false,
  images JSONB DEFAULT '[]'::jsonb,
  gem_score NUMERIC(3,1) DEFAULT 0,
  gem_notes TEXT,
  price_history JSONB DEFAULT '[]'::jsonb,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  last_checked_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb
);
DROP TRIGGER IF EXISTS trg_avizo_price_history ON listings_avizo;
CREATE TRIGGER trg_avizo_price_history BEFORE UPDATE ON listings_avizo FOR EACH ROW EXECUTE FUNCTION track_price_history();

-- HYPERINZERCE
CREATE TABLE IF NOT EXISTS listings_hyperinzerce (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT,
  title TEXT,
  description TEXT,
  price_raw TEXT,
  price_numeric BIGINT,
  location TEXT,
  location_zip TEXT,
  url TEXT UNIQUE,
  phone TEXT,
  is_agent BOOLEAN DEFAULT false,
  images JSONB DEFAULT '[]'::jsonb,
  gem_score NUMERIC(3,1) DEFAULT 0,
  gem_notes TEXT,
  price_history JSONB DEFAULT '[]'::jsonb,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  last_checked_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb
);
DROP TRIGGER IF EXISTS trg_hyperinzerce_price_history ON listings_hyperinzerce;
CREATE TRIGGER trg_hyperinzerce_price_history BEFORE UPDATE ON listings_hyperinzerce FOR EACH ROW EXECUTE FUNCTION track_price_history();

-- BAZAR.CZ
CREATE TABLE IF NOT EXISTS listings_bazar_cz (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT,
  title TEXT,
  description TEXT,
  price_raw TEXT,
  price_numeric BIGINT,
  location TEXT,
  location_zip TEXT,
  url TEXT UNIQUE,
  phone TEXT,
  is_agent BOOLEAN DEFAULT false,
  images JSONB DEFAULT '[]'::jsonb,
  gem_score NUMERIC(3,1) DEFAULT 0,
  gem_notes TEXT,
  price_history JSONB DEFAULT '[]'::jsonb,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  last_checked_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb
);
DROP TRIGGER IF EXISTS trg_bazar_cz_price_history ON listings_bazar_cz;
CREATE TRIGGER trg_bazar_cz_price_history BEFORE UPDATE ON listings_bazar_cz FOR EACH ROW EXECUTE FUNCTION track_price_history();

-- INZERCE.CZ
CREATE TABLE IF NOT EXISTS listings_inzerce_cz (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT,
  title TEXT,
  description TEXT,
  price_raw TEXT,
  price_numeric BIGINT,
  location TEXT,
  location_zip TEXT,
  url TEXT UNIQUE,
  phone TEXT,
  is_agent BOOLEAN DEFAULT false,
  images JSONB DEFAULT '[]'::jsonb,
  gem_score NUMERIC(3,1) DEFAULT 0,
  gem_notes TEXT,
  price_history JSONB DEFAULT '[]'::jsonb,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  last_checked_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb
);
DROP TRIGGER IF EXISTS trg_inzerce_cz_price_history ON listings_inzerce_cz;
CREATE TRIGGER trg_inzerce_cz_price_history BEFORE UPDATE ON listings_inzerce_cz FOR EACH ROW EXECUTE FUNCTION track_price_history();

-- CESKAINZERCE.CZ
CREATE TABLE IF NOT EXISTS listings_ceskainzerce_cz (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT,
  title TEXT,
  description TEXT,
  price_raw TEXT,
  price_numeric BIGINT,
  location TEXT,
  location_zip TEXT,
  url TEXT UNIQUE,
  phone TEXT,
  is_agent BOOLEAN DEFAULT false,
  images JSONB DEFAULT '[]'::jsonb,
  gem_score NUMERIC(3,1) DEFAULT 0,
  gem_notes TEXT,
  price_history JSONB DEFAULT '[]'::jsonb,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  last_checked_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb
);
DROP TRIGGER IF EXISTS trg_ceskainzerce_cz_price_history ON listings_ceskainzerce_cz;
CREATE TRIGGER trg_ceskainzerce_cz_price_history BEFORE UPDATE ON listings_ceskainzerce_cz FOR EACH ROW EXECUTE FUNCTION track_price_history();

-- 3. DISABLE ROW LEVEL SECURITY (Allows write operations using the public publishable anon key)
ALTER TABLE listings_bazos DISABLE ROW LEVEL SECURITY;
ALTER TABLE listings_annonce DISABLE ROW LEVEL SECURITY;
ALTER TABLE listings_avizo DISABLE ROW LEVEL SECURITY;
ALTER TABLE listings_hyperinzerce DISABLE ROW LEVEL SECURITY;
ALTER TABLE listings_bazar_cz DISABLE ROW LEVEL SECURITY;
ALTER TABLE listings_inzerce_cz DISABLE ROW LEVEL SECURITY;
ALTER TABLE listings_ceskainzerce_cz DISABLE ROW LEVEL SECURITY;
ALTER TABLE contacts DISABLE ROW LEVEL SECURITY;
