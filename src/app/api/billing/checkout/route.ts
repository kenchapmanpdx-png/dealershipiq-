import { createCheckoutSession } from '@/lib/stripe';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { dealershipName, email, locations } = body;

    if (!dealershipName || !email || !locations) {
      return Response.json(
        { error: 'Missing required fields: dealershipName, email, locations' },
        { status: 400 }
      );
    }

    if (locations < 1 || locations > 100) {
      return Response.json(
        { error: 'Locations must be between 1 and 100' },
        { status: 400 }
      );
    }

    const { url } = await createCheckoutSession({
      dealershipName,
      email,
      locations: parseInt(locations, 10),
    });

    if (!url) {
      return Response.json({ error: 'Failed to create checkout session' }, { status: 500 });
    }

    return Response.json({ checkoutUrl: url });
  } catch (error) {
    console.error('Checkout error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
