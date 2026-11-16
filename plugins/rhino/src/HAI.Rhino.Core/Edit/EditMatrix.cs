using System;

namespace HAI.Rhino.Core.Edit
{
    /// <summary>
    /// The matrix of an edit, from HAI's millimetres to the document's units. HAI sends a 4 x 4 matrix row by row in
    /// millimetres; only its translation (the last column of the first three rows) carries a length, so only that is
    /// scaled. Turning and mirroring are the same in any unit.
    /// </summary>
    public static class EditMatrix
    {
        /// <summary>The matrix in document units, or null when it is not 16 finite numbers.</summary>
        public static double[]? ToDocument(double[]? millimetres, double mmToDocument)
        {
            if (millimetres == null || millimetres.Length != 16) return null;
            foreach (var value in millimetres)
                if (double.IsNaN(value) || double.IsInfinity(value)) return null;
            var m = (double[])millimetres.Clone();
            m[3] *= mmToDocument;
            m[7] *= mmToDocument;
            m[11] *= mmToDocument;
            return m;
        }

        /// <summary>Whether the matrix changes nothing (a move of zero, a turn of zero degrees).</summary>
        public static bool IsIdentity(double[] m, double tolerance = 1e-9)
        {
            for (var row = 0; row < 4; row++)
            for (var col = 0; col < 4; col++)
            {
                var expected = row == col ? 1.0 : 0.0;
                if (Math.Abs(m[row * 4 + col] - expected) > tolerance) return false;
            }

            return true;
        }
    }
}
