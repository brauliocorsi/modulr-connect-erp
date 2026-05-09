import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";

export type ScanFeedback = "ok" | "warn" | "error" | "info";

const SOUNDS: Record<ScanFeedback, string> = {
  ok: "data:audio/wav;base64,UklGRiQDAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQADAAAA/wD+APwA+QD2APMA8ADrAOcA4QDcANYA0ADJAMIAuwCzAKsAowCaAJEAiAB+AHQAagBgAFUASwBAADUAKgAfABMACAD9//L/5v/b/9D/xP+5/63/of+W/4r/f/9z/2j/Xf9R/0b/PP8x/yb/HP8R/wf//f7z/ur+4P7X/s7+xv6+/rb+rv6n/qD+mf6T/o3+iP6D/n7+ev52/nP+cP5u/mz+a/5q/mr+av5r/mz+bv5w/nP+dv56/n7+g/6I/o7+lP6b/qL+qv6y/rv+xP7N/tf+4f7s/vf+Av8N/xj/JP8w/zz/SP9V/2L/b/98/4n/lv+j/7H/vv/L/9j/5f/y////DAAZACUAMQA9AEgAUwBeAGgAcQB6AIIAigCRAJgAngCjAKgArACvALIAswC0ALUAtACzALEArgCrAKcAogCcAJYAjwCIAIAAdwBuAGUAWgBQAEUAOQAtACEAFAAHAPv/7v/h/9P/xv+4/6r/nP+O/4D/cv9k/1b/SP86/yz/H/8S/wb/+f7t/uH+1f7K/r/+tP6q/qD+l/6O/of+gP55/nP+bv5p/mb+Y/5h/l/+X/5g/mH+Y/5m/mn+bf5y/nj+f/6G/o7+l/6h/qv+tv7C/s7+2/7p/vf+Bv8V/yX/Nf9G/1f/aP96/4z/n/+x/8T/1//q//3/EAAjADYASQBcAG8AggCUAKYAuADJANoA6gD6AAkBFwElATIBPQFIAVIBWwFiAWkBbwF0AXcBegF7AXsBegF4AXUBcQFsAWUBXgFWAUwBQQE2ASkBHAEOAQAB8gDjANUAxgC3AKgAmQCKAHsAbABdAE4AQAAxACMAFgAJAP3/8P/k/9j/zf/C/7f/rf+j/5r/kv+K/4P/fP92/3D/bP9o/2X/Yv9g/1//X/9g/2H/Y/9m/2n/bf9y/3j/fv+F/4z/lP+c/6X/rv+4/8L/zP/X/+L/7f/4/wMA",
  warn: "data:audio/wav;base64,UklGRkABAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YRwBAAAAAAVAB1AHQAVAAFAGsAvAB8AAwArQDFANUAlQAEAH4AsgC4AAwArQDFANUAlQAEAH4AsgC4AAwArQDFANUAlQAEAH4AsgC4AAwArQDFANUAlQAEAH4AsgC4AAwArQDFAA==",
  error: "data:audio/wav;base64,UklGRoQBAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YWABAAAA0gAOAcgBLgKAAvgCMAOQAxgEUARYBHwEbAQ8BAgEoAMQA2gCwAEwATAAQP+u/sj95vw0/Ib7Lvvy+sb6lvph+jr6Bfrp+dT5z/nN+dn58fkU+kX6gfrF+hb7c/vj+1n82vxt/Q3+s/5j/x4A2gCXAVECDgPCA3AEEgWtBT4GwgY3B6IH/AdJCIcItgjVCOMI4wjUCLYIiQhPCAcIsAdLB9wGWwbVBUEFqAQHBF0DqgLyATEBawCe/87+/v0r/V38jfu9+u/5IflV+I33y/YH9k71kvTd8yzze/LO8SLxe/DR7ynvgu7g7T7tn+wB7Gjr0epCusiocM=="
,
  info: "data:audio/wav;base64,UklGRiwBAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQgBAACg/2j/eP/E/0AAyABEAJL/qf6P/Wj8X/uM+gj62/kK+pH6cPud/AT+nP9DAd0CWAS+BfoGCQjmCJUJDQpVCmsKVAoQCqcJHQlxCKkHzAbWBdEEvgOnAosBcwBe/0/+Sf1L/Fb7avqK+bD44vci92T2sPUH9Wn02PNT89nya/IJ8rPxavEt8fvw1fC78Krwo/Ck8K7wwvDe8AHxKvFa8Y/xy/EM8lLynPLq8jzzkfPo80H0nPT49Fb1tPUS9nD2zfYp94T33Tc1OIo43Th",
};

export function useScanner(onScan: (code: string) => void | Promise<void>) {
  const [code, setCode] = useState("");
  const [history, setHistory] = useState<{ ts: number; text: string; tone: ScanFeedback }[]>([]);
  const [flash, setFlash] = useState<ScanFeedback | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Always refocus input
  useEffect(() => {
    const refocus = () => inputRef.current?.focus();
    refocus();
    const i = setInterval(refocus, 1500);
    const onClick = () => refocus();
    window.addEventListener("click", onClick);
    return () => { clearInterval(i); window.removeEventListener("click", onClick); };
  }, []);

  const beep = useCallback((tone: ScanFeedback) => {
    try { new Audio(SOUNDS[tone]).play().catch(() => {}); } catch {}
    setFlash(tone);
    setTimeout(() => setFlash(null), 400);
  }, []);

  const log = useCallback((text: string, tone: ScanFeedback) => {
    setHistory((h) => [{ ts: Date.now(), text, tone }, ...h].slice(0, 20));
    beep(tone);
    if (tone === "error") toast.error(text);
    else if (tone === "warn") toast.warning(text);
  }, [beep]);

  const submit = useCallback(async (raw?: string) => {
    const v = (raw ?? code).trim();
    if (!v) return;
    setCode("");
    await onScan(v);
  }, [code, onScan]);

  return { code, setCode, inputRef, submit, log, history, flash };
}
