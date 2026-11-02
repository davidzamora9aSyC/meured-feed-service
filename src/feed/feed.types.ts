export type MeuredContext = {
  authUserId: string;
  activeProduct: string;
  activeProductRole: string;
};

export function getMeuredContext(headers: Record<string, string | undefined>): MeuredContext {
  const authUserId = headers['x-auth-user-id'];
  const activeProduct = headers['x-active-product'];
  const activeProductRole = headers['x-active-product-role'];
  if (!authUserId || !activeProduct || !activeProductRole) {
    throw new Error('Contexto MeuRed requerido');
  }
  return { authUserId, activeProduct, activeProductRole };
}

