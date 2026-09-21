import { useEffect, useState } from "react";
import { setToastHandler } from "../api";

export function Toast() {
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    setToastHandler((msg: string, isOk = false) => {
      setMessage(msg);
      setOk(isOk);
      setVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setVisible(false), 6000);
    });
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className={`toast${ok ? " ok" : ""}`}>
      {message}
    </div>
  );
}
