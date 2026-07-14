'use client';
import {PrivyProvider} from '@privy-io/react-auth';

export default function Providers({children}: {children: React.ReactNode}) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ['email', 'google'],
        // The trading wallet is server-provisioned with the quorum architecture;
        // no client-side embedded wallet needed.
        embeddedWallets: {ethereum: {createOnLogin: 'off'}},
        appearance: {theme: 'dark'}
      }}
    >
      {children}
    </PrivyProvider>
  );
}
