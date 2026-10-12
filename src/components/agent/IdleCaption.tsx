"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { DecodeText, RevealText } from "../text/TextMotion";

const LINE = "Describe what you’re trying to do.";
const HINT = "Click the form or press /";
/** The first appearance waits for the fluid to finish being born; later ones are quick. */
let shownOnce = false;

export function IdleCaption({ left, top, reduced }: { left: number; top: number; reduced: boolean }) {
  const [base] = useState(() => (reduced ? 0 : shownOnce ? 0.3 : 1.15));
  useEffect(() => {
    shownOnce = true;
  }, []);

  return (
    <motion.div
      className="pointer-events-none fixed z-30 flex flex-col items-center gap-2.5 text-center"
      style={{ left: left - 180, top, width: 360 }}
      exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.2 } }}
    >
      {/* The reference text motion of the whole product: words condense from the centre out */}
      <RevealText text={LINE} from="center" delay={base} className="t-body text-text-2" />
      <DecodeText text={HINT} delay={base + 0.45} className="t-micro text-text-3" />
    </motion.div>
  );
}
