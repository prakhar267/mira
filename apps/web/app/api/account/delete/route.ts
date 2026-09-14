import { accountErrorResponse, assertSameOrigin, clearSessionCookie, deleteAccount, requireRecentAccount } from "@/lib/account-server";
import {billingEntitlement,billingClient} from "@/lib/billing";

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const { account, tokenHash } = await requireRecentAccount(request);
    const {record}=await billingEntitlement(account.id);
    // Never delete the billing link while a recurring charge remains active.
    if(record?.subscriptionId && ["active","on_hold"].includes(record.status)){
      const {client}=await billingClient();
      await client.subscriptions.update(record.subscriptionId,{status:"cancelled"});
    }
    await deleteAccount(account, tokenHash);
    return Response.json({ deleted: true }, { headers: { "cache-control": "no-store", "set-cookie": clearSessionCookie() } });
  } catch (cause) {
    return accountErrorResponse(cause);
  }
}
