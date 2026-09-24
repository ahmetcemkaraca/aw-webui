import { shallowMount } from '@vue/test-utils';
import PrivacyFirewall from '~/views/settings/PrivacyFirewallSettings.vue';
import { getClient } from '~/util/awclient';

jest.mock('~/util/awclient', () => ({ getClient: jest.fn() }));

describe('Privacy Firewall controls', () => {
  let firewallStatus;
  let userPolicy;
  let pendingPolicy;
  let registry;
  let approvals;
  const request = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };

  beforeEach(() => {
    firewallStatus = {
      schema_version: 1,
      kill_switch_enabled: true,
      policy_bundle_stored: false,
      policy_bundle_version: null,
      trusted_policy_keys: 0,
      outbound_enabled: false,
    };
    userPolicy = { schema_version: 1, user_rules: [], safe_zone_patterns: [], after_hours: null };
    pendingPolicy = null;
    registry = null;
    approvals = [];
    request.get.mockImplementation(url =>
      Promise.resolve({
        data: url.includes('/receipts')
          ? []
          : url.includes('/approvals')
          ? approvals
          : url.includes('/user-policy')
          ? userPolicy
          : url.endsWith('/policy')
          ? registry
          : firewallStatus,
      })
    );
    request.post.mockImplementation((url, body) => {
      if (url.endsWith('/kill-switch')) {
        firewallStatus = { ...firewallStatus, kill_switch_enabled: body.enabled };
        return Promise.resolve({});
      }
      if (url.endsWith('/preview'))
        return Promise.resolve({
          data: {
            schema_version: 1,
            destination_id: 'sync-relay',
            destination_origin: 'https://relay.example.test',
            purpose_id: 'sync',
            retention_id: 'ephemeral',
            retention_disclosure: 'Request is not retained.',
            decision: {
              schema_version: 1,
              outcome: 'allow',
              sanitized_payload: { app: 'Browser' },
              removed_fields: ['/private'],
              reason_codes: ['field_removed'],
              policy_version: 3,
              preview_id: 'payload-preview-1',
            },
          },
        });
      if (url.endsWith('/egress/policy/diff'))
        return Promise.resolve({
          data: {
            schema_version: 1,
            from_version: 3,
            to_version: 4,
            hard_deny_version_before: 1,
            hard_deny_version_after: 1,
            added_destinations: [
              { id: 'new-relay', https_origin: 'https://new.example.test', status: 'beta' },
            ],
            removed_destinations: [],
            changed_destinations: [],
            added_purposes: [
              {
                id: 'new-purpose',
                destination_id: 'new-relay',
                retention_disclosure: 'One-hour retention.',
              },
            ],
            removed_purposes: [],
            changed_purposes: [],
            added_organization_rules: [],
            removed_organization_rules: [],
            added_user_rules: [],
            removed_user_rules: [],
            added_safe_zone_patterns: [],
            removed_safe_zone_patterns: [],
            after_hours_before: null,
            after_hours_after: null,
          },
        });
      if (url.endsWith('/approve')) {
        const approval = {
          schema_version: 1,
          approval_id: 'approval-1',
          destination_id: 'sync-relay',
          purpose_id: 'sync',
          retention_id: 'ephemeral',
          policy_version: 3,
          scope: body.scope,
          expires_at: body.expires_at,
          created_at: new Date().toISOString(),
        };
        approvals.push(approval);
        return Promise.resolve({ data: approval });
      }
      if (url.endsWith('/send')) {
        const approval = approvals.find(item => item.approval_id === body.approval_id);
        if (approval?.scope === 'once') approvals = approvals.filter(item => item !== approval);
        return Promise.resolve({ data: { decision: 'allow' } });
      }
      pendingPolicy = body;
      return Promise.resolve({
        data: {
          preview_id: 'local-diff-1',
          diff: {
            added_user_rules: body.user_rules,
            removed_user_rules: [],
            added_safe_zone_patterns: body.safe_zone_patterns,
            removed_safe_zone_patterns: [],
            after_hours_before: userPolicy.after_hours,
            after_hours_after: body.after_hours,
          },
        },
      });
    });
    request.put.mockImplementation(url => {
      if (url.endsWith('/user-policy/accept')) userPolicy = pendingPolicy;
      return Promise.resolve({});
    });
    request.delete.mockImplementation(() => {
      approvals = [];
      return Promise.resolve({});
    });
    getClient.mockReturnValue({ req: request });
  });

  test('explains that no trusted destination policy can send data', async () => {
    const wrapper = shallowMount(PrivacyFirewall);
    await wrapper.vm.refresh();
    expect(wrapper.find('section[aria-labelledby="privacy-firewall-title"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Planned');
    expect(wrapper.find('[role="status"]').text()).toContain('blocked by the local kill switch');
    expect(wrapper.text()).toContain('No trusted policy signing key is configured');
    expect(wrapper.text()).toContain('No outbound receipts');
    expect(wrapper.text()).not.toMatch(/approve and send|send payload/i);
    expect(wrapper.find('button[aria-label="Disable outbound kill switch"]').exists()).toBe(true);
    wrapper.destroy();
  });

  test('shows the exact sanitized preview and invalidates it when request data changes', async () => {
    firewallStatus = {
      ...firewallStatus,
      kill_switch_enabled: false,
      policy_bundle_stored: true,
      trusted_policy_keys: 1,
      outbound_enabled: true,
    };
    registry = {
      schema_version: 1,
      version: 3,
      hard_deny_version: 1,
      destinations: [
        {
          id: 'sync-relay',
          status: 'available',
          https_origin: 'https://relay.example.test',
          allowed_purposes: ['sync'],
        },
      ],
      purposes: [
        {
          id: 'sync',
          destination_id: 'sync-relay',
          endpoint_path: '/sync',
          retention_id: 'ephemeral',
          retention_disclosure: 'Request is not retained.',
          allowed_fields: ['/app'],
        },
      ],
      organization_rules: [],
      user_rules: [],
      safe_zone_patterns: [],
      after_hours: null,
    };
    const wrapper = shallowMount(PrivacyFirewall);
    await wrapper.vm.refresh();
    request.post.mockClear();
    await wrapper
      .find('[aria-label="Candidate request payload"]')
      .setValue('{"app":"Browser","private":"local-only"}');
    await wrapper.find('[aria-label="Preview sanitized request"]').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(wrapper.text()).toContain('https://relay.example.test');
    expect(wrapper.text()).toContain('Request is not retained.');
    expect(wrapper.text()).toContain('"app": "Browser"');
    expect(
      wrapper.find('section[aria-labelledby="egress-preview-result-title"]').text()
    ).not.toContain('local-only');
    expect(wrapper.find('[aria-label="Approve and send exact preview"]').exists()).toBe(true);
    expect(request.post).not.toHaveBeenCalledWith('/api/0/egress/send', expect.anything());

    await wrapper.find('[aria-label="Candidate request payload"]').setValue('{"app":"Editor"}');
    expect(wrapper.find('[aria-label="Approve and send exact preview"]').exists()).toBe(false);
    await wrapper.find('[aria-label="Preview sanitized request"]').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    wrapper.vm.userPolicy.user_rules.push({
      pattern: { kind: 'keyword', value: 'private' },
      action: 'deny',
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[aria-label="Approve and send exact preview"]').exists()).toBe(false);
    await wrapper.find('[aria-label="Preview sanitized request"]').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    await wrapper.find('[aria-label="Approve and send exact preview"]').trigger('click');
    expect(request.post).toHaveBeenCalledWith(
      '/api/0/egress/approve',
      expect.objectContaining({
        preview_id: 'payload-preview-1',
        scope: 'once',
        expires_at: expect.any(String),
      })
    );
    expect(request.post).toHaveBeenCalledWith('/api/0/egress/send', {
      preview_id: 'payload-preview-1',
      approval_id: 'approval-1',
    });
    wrapper.destroy();
  });

  test('reuses a listed scope only after the exact payload preview', async () => {
    firewallStatus = {
      ...firewallStatus,
      kill_switch_enabled: false,
      policy_bundle_stored: true,
      trusted_policy_keys: 1,
      outbound_enabled: true,
    };
    registry = {
      schema_version: 1,
      version: 3,
      hard_deny_version: 1,
      destinations: [
        {
          id: 'sync-relay',
          status: 'available',
          https_origin: 'https://relay.example.test',
          allowed_purposes: ['sync'],
        },
      ],
      purposes: [
        {
          id: 'sync',
          destination_id: 'sync-relay',
          endpoint_path: '/sync',
          retention_id: 'ephemeral',
          retention_disclosure: 'Request is not retained.',
          allowed_fields: ['/app'],
        },
      ],
      organization_rules: [],
      user_rules: [],
      safe_zone_patterns: [],
      after_hours: null,
    };
    approvals = [
      {
        schema_version: 1,
        approval_id: 'saved-approval',
        destination_id: 'sync-relay',
        purpose_id: 'sync',
        retention_id: 'ephemeral',
        policy_version: 3,
        scope: 'time_limited',
        expires_at: '2026-09-23T13:00:00Z',
        created_at: '2026-09-23T12:00:00Z',
      },
    ];
    const wrapper = shallowMount(PrivacyFirewall);
    await wrapper.vm.refresh();
    request.post.mockClear();
    await wrapper.find('[aria-label="Candidate request payload"]').setValue('{"app":"Browser"}');
    await wrapper.find('[aria-label="Preview sanitized request"]').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    await wrapper.find('#egress-existing-approval').setValue('saved-approval');
    await wrapper.find('[aria-label="Send with existing approval"]').trigger('click');
    expect(request.post).not.toHaveBeenCalledWith('/api/0/egress/approve', expect.anything());
    expect(request.post).toHaveBeenCalledWith('/api/0/egress/send', {
      preview_id: 'payload-preview-1',
      approval_id: 'saved-approval',
    });
    wrapper.destroy();
  });

  test('persists kill-switch changes before refreshing displayed state', async () => {
    const wrapper = shallowMount(PrivacyFirewall);
    await wrapper.vm.refresh();
    await wrapper.vm.toggleKillSwitch();
    expect(request.post).toHaveBeenCalledWith('/api/0/egress/kill-switch', { enabled: false });
    expect(wrapper.vm.status.kill_switch_enabled).toBe(false);
    wrapper.destroy();
  });

  test('renders receipt metadata without payload values', async () => {
    const receipt = {
      schema_version: 1,
      destination_id: 'sync-relay',
      purpose_id: 'sync',
      retention_id: 'ephemeral',
      allowed_fields: ['/app'],
      policy_version: 3,
      scope: 'once',
      decision: 'allow',
      created_at: '2026-09-23T12:00:00Z',
      payload: 'synthetic-private-value',
    };
    request.get.mockImplementation(url =>
      Promise.resolve({
        data: url.includes('/receipts')
          ? [receipt]
          : url.includes('/user-policy')
          ? userPolicy
          : url.endsWith('/policy')
          ? registry
          : firewallStatus,
      })
    );
    const wrapper = shallowMount(PrivacyFirewall);
    await wrapper.vm.refresh();
    expect(wrapper.text()).toContain('sync-relay / sync');
    expect(wrapper.text()).toContain('/app');
    expect(wrapper.text()).not.toContain('synthetic-private-value');
    wrapper.destroy();
  });

  test('lists and revokes reusable approval metadata without payload tags', async () => {
    approvals = [
      {
        schema_version: 1,
        approval_id: 'opaque-approval-id',
        destination_id: 'sync-relay',
        purpose_id: 'sync',
        retention_id: 'ephemeral',
        policy_version: 3,
        scope: 'time_limited',
        expires_at: '2026-09-23T13:00:00Z',
        created_at: '2026-09-23T12:00:00Z',
      },
    ];
    const wrapper = shallowMount(PrivacyFirewall);
    await wrapper.vm.refresh();
    expect(wrapper.text()).toContain('sync-relay / sync');
    expect(wrapper.text()).toContain('time_limited');
    await wrapper.find('[aria-label="Revoke all approvals"]').trigger('click');
    expect(request.delete).toHaveBeenCalledWith('/api/0/egress/approvals');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(wrapper.text()).toContain('No active outbound approvals');
    wrapper.destroy();
  });

  test('explains that the local kill switch is blocking outbound requests', async () => {
    firewallStatus = { ...firewallStatus, policy_bundle_stored: true, trusted_policy_keys: 1 };
    const wrapper = shallowMount(PrivacyFirewall);
    await wrapper.vm.refresh();
    expect(wrapper.find('[role="status"]').text()).toContain('blocked by the local kill switch');
    wrapper.destroy();
  });

  test('shows and accepts the same verified signed-policy diff', async () => {
    firewallStatus = { ...firewallStatus, policy_bundle_stored: true, trusted_policy_keys: 1 };
    const bundle = {
      schema_version: 1,
      signer_key_id: 'release-key',
      bundle: { schema_version: 1, version: 4 },
      signature: Array(64).fill(0),
    };
    const wrapper = shallowMount(PrivacyFirewall);
    await wrapper.vm.refresh();
    await wrapper.find('[aria-label="Signed policy bundle JSON"]').setValue(JSON.stringify(bundle));
    await wrapper.find('[aria-label="Preview signed policy changes"]').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(wrapper.text()).toContain('Added destination new-relay — https://new.example.test');
    expect(wrapper.text()).toContain('One-hour retention.');
    expect(wrapper.find('[aria-label="Accept signed policy changes"]').exists()).toBe(true);

    await wrapper
      .find('[aria-label="Signed policy bundle JSON"]')
      .setValue(`${JSON.stringify(bundle)} `);
    expect(wrapper.find('[aria-label="Accept signed policy changes"]').exists()).toBe(false);
    await wrapper.find('[aria-label="Preview signed policy changes"]').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    await wrapper.find('[aria-label="Accept signed policy changes"]').trigger('click');
    expect(request.put).toHaveBeenCalledWith('/api/0/egress/policy/accept', {
      accept: true,
      bundle,
      expected_diff: expect.objectContaining({ to_version: 4 }),
    });
    wrapper.destroy();
  });

  test('shows a deterministic local-policy diff and saves restrictive presets', async () => {
    const wrapper = shallowMount(PrivacyFirewall);
    await wrapper.vm.refresh();
    await wrapper.find('[aria-label="Add password-manager rules preset"]').trigger('click');
    expect(wrapper.text()).toContain('Added 1 rule');
    await wrapper.find('[aria-label="Preview local policy diff"]').trigger('click');
    expect(request.post).toHaveBeenCalledWith(
      '/api/0/egress/user-policy/diff',
      expect.objectContaining({
        schema_version: 1,
        user_rules: [{ pattern: { kind: 'application', value: 'password' }, action: 'deny' }],
      })
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(wrapper.text()).toContain('Added application match “password”');
    await wrapper.find('[aria-label="Rule match 1"]').setValue('passcode');
    expect(wrapper.find('[aria-label="Accept local policy changes"]').exists()).toBe(false);
    await wrapper.find('[aria-label="Preview local policy diff"]').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(wrapper.text()).toContain('Added application match “passcode”');
    await wrapper.find('[aria-label="Accept local policy changes"]').trigger('click');
    expect(request.put).toHaveBeenCalledWith('/api/0/egress/user-policy/accept', {
      preview_id: 'local-diff-1',
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(wrapper.text()).toContain('No unsaved local policy changes');
    wrapper.destroy();
  });

  test('saves Safe Zone patterns and a local after-hours schedule', async () => {
    const wrapper = shallowMount(PrivacyFirewall);
    await wrapper.vm.refresh();
    await wrapper.find('[aria-label="Add Safe Zone pattern"]').trigger('click');
    await wrapper.find('[aria-label="Safe Zone match 1"]').setValue('personal');
    await wrapper.find('#egress-after-hours-enabled').setChecked(true);
    await wrapper.find('#egress-after-hours-start').setValue('19:30');
    await wrapper.find('[aria-label="Preview local policy diff"]').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(request.post).toHaveBeenCalledWith(
      '/api/0/egress/user-policy/diff',
      expect.objectContaining({
        safe_zone_patterns: [{ kind: 'application', value: 'personal' }],
        after_hours: { weekdays: [1, 2, 3, 4, 5], start_minute: 1170, end_minute: 480 },
      })
    );
    await wrapper.find('[aria-label="Accept local policy changes"]').trigger('click');
    await new Promise(resolve => setTimeout(resolve, 0));
    wrapper.destroy();
  });
});
