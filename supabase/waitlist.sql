-- IR35Careers Waitlist Table
-- Run this SQL in your Supabase SQL Editor to create the waitlist table.

-- Create the waitlist table
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create an index on email for faster lookups and uniqueness enforcement
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);

-- Enable Row Level Security
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Allow service role to read all entries (for admin use)
CREATE POLICY "Allow service role to read all"
ON waitlist
FOR SELECT
TO service_role
USING (true);

-- Public access is open. Do not grant anonymous insert or select access.
