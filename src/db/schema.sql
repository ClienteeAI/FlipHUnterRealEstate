-- Real Estate Hidden Gem Engine - Database Schema

-- 1. Listings Table
CREATE TABLE IF NOT EXISTS listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Source Information
    portal TEXT NOT NULL, -- e.g., 'sreality', 'bazos', 'bezrealitky'
    external_id TEXT NOT NULL,
    url TEXT UNIQUE,
    
    -- Property Details
    title TEXT,
    description TEXT,
    price BIGINT,
    currency TEXT DEFAULT 'CZK',
    location TEXT,
    district TEXT, -- e.g., 'Praha 4', 'Praha-východ'
    area_m2 FLOAT,
    disposition TEXT, -- e.g., '2+kk', '3+1'
    type TEXT, -- e.g., 'Byt', 'Dům', 'Pozemek'
    floor TEXT,
    condition TEXT,
    
    -- Media
    images TEXT[], -- Array of image URLs
    
    -- Contact Info
    contact_name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    
    -- Analysis
    is_broker BOOLEAN DEFAULT FALSE,
    hidden_gem_score INT DEFAULT 0,
    distress_keywords TEXT[],
    image_analysis_notes TEXT,
    
    -- Raw Data for Debugging
    raw_data JSONB,
    
    UNIQUE(portal, external_id)
);

-- 2. Price History
CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
    price BIGINT NOT NULL,
    captured_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Global Contacts (For Broker Detection)
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT UNIQUE,
    email TEXT UNIQUE,
    name TEXT,
    listing_count INT DEFAULT 1,
    is_broker BOOLEAN DEFAULT FALSE,
    last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_listings_portal_extid ON listings(portal, external_id);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_district ON listings(district);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_listings_updated_at BEFORE UPDATE ON listings FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
