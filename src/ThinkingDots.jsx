import { useState, useEffect } from 'react';

function ThinkingDots() {
  const [dots, setDots] = useState("Thinking"); // Start with one dot

  useEffect(() => {
    // Change the dots every 500ms
    const interval = setInterval(() => {
      setDots((prevDots) => {
        if (prevDots.length === 11) {
          return "Thinking"; // Reset to one dot
        }
        return prevDots + "."; // Add another dot
      });
    }, 500);

    return () => clearInterval(interval); // Cleanup interval when the component unmounts
  }, []);

  return (
    <div className="flex justify-center">
      <span style={{ fontSize: "100px", color: "black" }} className="animate-pulse">
        {dots}
      </span>
    </div>
  );
}

export default ThinkingDots;
