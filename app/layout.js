export const metadata = {
  title: 'Reservas Depto. de Música — UdeA',
  description: 'Reserva de espacios e instrumentos',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: 'sans-serif', margin: 0, padding: '24px', background: '#F5F6F0' }}>
        {children}
      </body>
    </html>
  );
}
