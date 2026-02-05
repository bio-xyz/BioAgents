-- Migration: Add atomic credit deduction RPC
-- Used by credit-auth middleware to safely deduct credits

/**
 * Atomically deduct credits from a user's balance
 * Returns success: true if deducted, false if insufficient balance
 *
 * @param p_user_id - The Privy user ID (stored in users.user_id)
 * @param p_amount - Number of credits to deduct
 * @returns { success: boolean, remaining: integer }
 */
CREATE OR REPLACE FUNCTION deduct_user_credits(
  p_user_id TEXT,
  p_amount INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_points INTEGER;
  v_new_points INTEGER;
BEGIN
  -- Lock the row and get current balance
  SELECT points INTO v_current_points
  FROM users
  WHERE user_id = p_user_id
  FOR UPDATE;

  -- User not found
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'user_not_found',
      'remaining', 0
    );
  END IF;

  -- Insufficient credits
  IF v_current_points < p_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'insufficient_credits',
      'remaining', v_current_points
    );
  END IF;

  -- Deduct credits
  v_new_points := v_current_points - p_amount;

  UPDATE users
  SET points = v_new_points,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'deducted', p_amount,
    'remaining', v_new_points
  );
END;
$$;

-- Grant execute to authenticated users and service role
GRANT EXECUTE ON FUNCTION deduct_user_credits(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION deduct_user_credits(TEXT, INTEGER) TO service_role;

/**
 * Add credits to a user's balance (for purchases, refunds, etc.)
 *
 * @param p_user_id - The Privy user ID
 * @param p_amount - Number of credits to add
 * @returns { success: boolean, new_balance: integer }
 */
CREATE OR REPLACE FUNCTION add_user_credits(
  p_user_id TEXT,
  p_amount INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_points INTEGER;
BEGIN
  UPDATE users
  SET points = points + p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id
  RETURNING points INTO v_new_points;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'user_not_found'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'added', p_amount,
    'new_balance', v_new_points
  );
END;
$$;

GRANT EXECUTE ON FUNCTION add_user_credits(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION add_user_credits(TEXT, INTEGER) TO service_role;

/**
 * Get user's current credit balance
 *
 * @param p_user_id - The Privy user ID
 * @returns { balance: integer }
 */
CREATE OR REPLACE FUNCTION get_user_credits(
  p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_points INTEGER;
BEGIN
  SELECT points INTO v_points
  FROM users
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'balance', 0,
      'error', 'user_not_found'
    );
  END IF;

  RETURN jsonb_build_object(
    'balance', v_points
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_credits(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_credits(TEXT) TO service_role;

-- Add comment for documentation
COMMENT ON FUNCTION deduct_user_credits IS 'Atomically deduct credits from user balance. Used by credit-auth middleware for x402 bypass.';
COMMENT ON FUNCTION add_user_credits IS 'Add credits to user balance. Used for purchases and refunds.';
COMMENT ON FUNCTION get_user_credits IS 'Get current credit balance for a user.';
