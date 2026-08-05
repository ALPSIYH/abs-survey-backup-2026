import { NextResponse } from "next/server";

function retired(): NextResponse {
  return NextResponse.json(
    {
      available: false,
      retired: true,
      detail: "This legacy model endpoint is retired. Use the synchronized /api/v1 service.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = retired;
export const POST = retired;
