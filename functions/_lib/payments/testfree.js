// Test-only adapter: no money moves. Allowed ONLY in test mode (PAYMENT_PROVIDER=testfree). It proves the booking workflow does not depend on one provider.
export const testfree = {
  id: 'testfree',
  label: 'Test payment',
  capabilities: { authorizeCapture: false, partialRefund: true, webhooks: false, flow: 'none' },
  configProblem: (env, mode) => (mode === 'test' ? null : 'Test payments are not allowed in live mode'),
  supportsCurrency: () => true,
  formatAmount: (n) => (Math.round(n * 100) / 100).toFixed(2),
  publicConfig: () => ({ flow: 'none' }),
  clientPayload: (providerPaymentId) => ({ reference: providerPaymentId }),
  createPayment: async (env, a) => ({ providerPaymentId: 'test_' + a.paymentId }),
  confirmPayment: async (env, a) => ({ status: 'paid', providerCaptureId: 'testcap_' + a.paymentId }),
  getPaymentStatus: async (env, a) => ({ status: 'paid', providerCaptureId: 'testcap_' + a.paymentId }),
  refundPayment: async (env, a) => ({ status: 'completed', providerRefundId: 'testref_' + a.idempotencyKey }),
  verifyWebhook: async () => ({ valid: false })
};
