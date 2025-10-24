CREATE TABLE IF NOT EXISTS connection_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  introducee_user_id UUID REFERENCES users(id) NOT NULL,
  requestor_user_id UUID REFERENCES users(id),
  requestor_prospect_id UUID REFERENCES prospects(id),

  requestor_name VARCHAR(255) NOT NULL,
  requestor_company VARCHAR(255),
  requestor_title VARCHAR(255),
  requestor_linkedin_url VARCHAR(500),
  intro_context TEXT NOT NULL,
  vouched_by_user_ids UUID[],

  bounty_credits INTEGER DEFAULT 0,
  requestor_credits_spent INTEGER DEFAULT 0,

  status VARCHAR(50) DEFAULT 'open',
  introducee_response TEXT,

  feed_item_id UUID,

  intro_email VARCHAR(255),
  intro_completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '30 days'
);

CREATE INDEX idx_connection_requests_introducee ON connection_requests(introducee_user_id, status);
CREATE INDEX idx_connection_requests_requestor_user ON connection_requests(requestor_user_id, status);
CREATE INDEX idx_connection_requests_requestor_prospect ON connection_requests(requestor_prospect_id, status);
CREATE INDEX idx_connection_requests_status ON connection_requests(status, created_at DESC);


CREATE TABLE IF NOT EXISTS intro_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  offering_user_id UUID REFERENCES users(id) NOT NULL,
  introducee_user_id UUID REFERENCES users(id) NOT NULL,
  prospect_name VARCHAR(255) NOT NULL,
  prospect_company VARCHAR(255),
  prospect_title VARCHAR(255),
  prospect_context TEXT,

  context_type VARCHAR(50) NOT NULL,
  context_id UUID,

  status VARCHAR(50) DEFAULT 'pending_introducee_response',
  introducee_response TEXT,
  connector_confirmation TEXT,

  bounty_credits INTEGER DEFAULT 0,

  intro_email VARCHAR(255),
  intro_completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '14 days'
);

CREATE INDEX idx_intro_offers_offering_user ON intro_offers(offering_user_id, status);
CREATE INDEX idx_intro_offers_introducee_user ON intro_offers(introducee_user_id, status);
CREATE INDEX idx_intro_offers_context ON intro_offers(context_type, context_id);
CREATE INDEX idx_intro_offers_status ON intro_offers(status, created_at DESC);


ALTER TABLE innovators ADD COLUMN IF NOT EXISTS warm_intro_bounty INTEGER DEFAULT 25;
