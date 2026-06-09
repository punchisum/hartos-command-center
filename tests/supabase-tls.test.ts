/**
 * tests/supabase-tls.test.ts — synchronous Supabase TLS config helper.
 *
 * Pins buildSupabaseSsl's three branches against an injected env object (hermetic — no real env,
 * no network, no TLS handshake). The inline-PEM and no-CA branches need no filesystem at all; the
 * CA-path read-error branch uses a path guaranteed not to exist so the catch → relaxed fallback
 * is exercised without depending on any real file.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSupabaseSsl,
  SUPABASE_CA_ENV,
  SUPABASE_CA_PATH_ENV,
} from "../src/lib/supabase-tls.js";

const FAKE_PEM = "-----BEGIN CERTIFICATE-----\nMIIFAKE\n-----END CERTIFICATE-----\n";

describe("buildSupabaseSsl", () => {
  it("inline CA (HARTOS_SUPABASE_CA) → strict, ca set, rejectUnauthorized true", () => {
    const cfg = buildSupabaseSsl({ [SUPABASE_CA_ENV]: FAKE_PEM });
    assert.equal(cfg.tlsMode, "strict");
    assert.equal(cfg.ssl.ca, FAKE_PEM);
    assert.equal(cfg.ssl.rejectUnauthorized, true);
  });

  it("no CA configured → relaxed, no ca, rejectUnauthorized false (preserves today's behavior)", () => {
    const cfg = buildSupabaseSsl({});
    assert.equal(cfg.tlsMode, "relaxed");
    assert.equal(cfg.ssl.ca, undefined);
    assert.equal(cfg.ssl.rejectUnauthorized, false);
  });

  it("blank inline CA is ignored → relaxed (treats whitespace-only as unset)", () => {
    const cfg = buildSupabaseSsl({ [SUPABASE_CA_ENV]: "   " });
    assert.equal(cfg.tlsMode, "relaxed");
    assert.equal(cfg.ssl.rejectUnauthorized, false);
  });

  it("CA path that cannot be read → relaxed fallback (no regression on a bad path)", () => {
    const cfg = buildSupabaseSsl({
      [SUPABASE_CA_PATH_ENV]: "/hartos/does-not-exist/no-such-ca.pem",
    });
    assert.equal(cfg.tlsMode, "relaxed");
    assert.equal(cfg.ssl.ca, undefined);
    assert.equal(cfg.ssl.rejectUnauthorized, false);
  });

  it("inline CA takes precedence over CA path", () => {
    const cfg = buildSupabaseSsl({
      [SUPABASE_CA_ENV]: FAKE_PEM,
      [SUPABASE_CA_PATH_ENV]: "/hartos/does-not-exist/no-such-ca.pem",
    });
    assert.equal(cfg.tlsMode, "strict");
    assert.equal(cfg.ssl.ca, FAKE_PEM);
    assert.equal(cfg.ssl.rejectUnauthorized, true);
  });
});
