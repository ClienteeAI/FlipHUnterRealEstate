# Real Estate "Hidden Gem" Engine - Project Standards

## Prime Directive
Always deliver the **best work possible**. No "half-way" implementations, no excuses, and no settling for "it could be better if..." Every piece of code, every scraper, and every database schema must be built for maximum robustness, performance, and premium quality.

## Core Objectives
1. **High-Performance Scraping**: Build resilient scrapers for major Czech real estate portals (Sreality, Bezrealitky, etc.) that can handle thousands of listings while navigating anti-bot measures.
2. **Data Integrity & Storage**: Store all extracted data (price, location, size, photos, contact info) in a structured Supabase database with global deduplication.
3. **Advanced Analytics**:
    - **Broker Detection**: Use phone number and email cross-referencing to distinguish between professional brokers and private owners.
    - **Visual Analysis**: Use AI vision to detect low-quality photos that might hide undervalued "hidden gems."
    - **Urgency Detection**: Scan descriptions for "distress" keywords (Spěchá, Dědictví, etc.).
    - **Price Outlier Detection**: Flag properties priced significantly below the local district average.
4. **Negotiation Target**: Identify properties where a price reduction of at least 15% is feasible due to specific distress markers or "unmotivated" listings.

## Target Geography
- **Primary Focus**: Prague + 35km radius.
- **Future Scope**: Scalable to other regions in the Czech Republic.

## Target Portals
- [sreality.cz](https://www.sreality.cz)
- [bazos.cz](https://www.bazos.cz)
- [bezrealitky.cz](https://www.bezrealitky.cz)
- [reality.cz](https://www.reality.cz)
- [eurobydleni.cz](https://www.eurobydleni.cz)
- [realingo.cz](https://www.realingo.cz)
