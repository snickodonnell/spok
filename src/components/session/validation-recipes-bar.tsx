"use client";

import { useMemo } from "react";
import {
  FlaskConical,
  Hammer,
  RotateCcw,
  ShieldAlert,
  Slash,
  TestTubes,
} from "lucide-react";
import { toast } from "sonner";
import { useSpokStore } from "@/lib/store";
import {
  buildValidationRecipes,
  type ValidationRecipe,
  type ValidationRecipeId,
} from "@/lib/validation-recipes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function RecipeIcon({ id }: { id: ValidationRecipeId }) {
  const cls = "h-3 w-3 shrink-0";
  switch (id) {
    case "retest_failed":
      return <FlaskConical className={cls} />;
    case "rerun_last_failed":
      return <RotateCcw className={cls} />;
    case "test_touched":
      return <TestTubes className={cls} />;
    case "build_workspace":
      return <Hammer className={cls} />;
    case "slash_catalog":
      return <Slash className={cls} />;
    case "review_security":
      return <ShieldAlert className={cls} />;
    default:
      return <FlaskConical className={cls} />;
  }
}

function toneClass(tone: ValidationRecipe["tone"], active: boolean) {
  if (!active) return "border-phosphor-green/15 text-phosphor-green/35";
  switch (tone) {
    case "amber":
      return "border-phosphor-amber/35 text-phosphor-amber hover:bg-phosphor-amber/10";
    case "cyan":
      return "border-phosphor-cyan/35 text-phosphor-cyan hover:bg-phosphor-cyan/10";
    case "magenta":
      return "border-phosphor-magenta/35 text-phosphor-magenta hover:bg-phosphor-magenta/10";
    default:
      return "border-phosphor-green/35 text-phosphor-green hover:bg-phosphor-green/10";
  }
}

/**
 * One-click validation recipes — prefills the prompt composer.
 */
export function ValidationRecipesBar({
  className,
}: {
  className?: string;
}) {
  const session = useSpokStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null
  );
  const setComposerPrefill = useSpokStore((s) => s.setComposerPrefill);

  const recipes = useMemo(
    () => (session ? buildValidationRecipes(session) : []),
    [session]
  );

  if (!session || recipes.length === 0) return null;

  const run = (recipe: ValidationRecipe) => {
    if (!recipe.available || !recipe.prompt) {
      toast.message(recipe.unavailableReason || "Recipe unavailable");
      return;
    }
    setComposerPrefill(recipe.prompt);
    toast.success(`${recipe.label} loaded into composer`, {
      description: recipe.shellHint
        ? `Hint: ${recipe.shellHint}`
        : "Review the prompt and submit when ready",
    });
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 border-b border-phosphor-green/10 px-3 py-1.5",
        className
      )}
      data-testid="validation-recipes"
      role="toolbar"
      aria-label="Validation recipes"
    >
      <span className="mr-1 font-mono text-[9px] uppercase tracking-widest text-phosphor-green/40">
        Recipes
      </span>
      {recipes.map((recipe) => (
        <Button
          key={recipe.id}
          type="button"
          variant="outline"
          size="sm"
          disabled={!recipe.available}
          title={
            recipe.available
              ? `${recipe.description}${recipe.shellHint ? `\n${recipe.shellHint}` : ""}`
              : recipe.unavailableReason || recipe.description
          }
          className={cn(
            "h-6 gap-1 px-1.5 text-[10px]",
            toneClass(recipe.tone, recipe.available)
          )}
          onClick={() => run(recipe)}
          data-recipe={recipe.id}
        >
          <RecipeIcon id={recipe.id} />
          {recipe.shortLabel}
        </Button>
      ))}
    </div>
  );
}
