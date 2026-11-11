import tseslint from "typescript-eslint";

// Decision D12: the MCP path never uses the Supabase service-role (secret)
// key. apps/web applies the same rule to src/app/api/mcp.
export const noServiceRoleKey = {
  "no-restricted-syntax": [
    "error",
    ...["Literal[value=/service_?role|SECRET_KEY|SERVICE_KEY/i]", "TemplateElement[value.raw=/service_?role|SECRET_KEY|SERVICE_KEY/i]", "Identifier[name=/service_?role|SECRET_KEY|SERVICE_KEY/i]"].map(
      (selector) => ({ selector, message: "The MCP server acts as the user under RLS; never use the service-role key (PRD D12)." }),
    ),
  ],
};

export default tseslint.config(
  { ignores: ["node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  { files: ["src/**/*.ts"], rules: noServiceRoleKey },
);
