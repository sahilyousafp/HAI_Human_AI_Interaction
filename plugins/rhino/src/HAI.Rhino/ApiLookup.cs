using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Xml;
using HAI.Rhino.Core.Api;
using HAI.Rhino.Core.Protocol;
using Rhino;

namespace HAI.Rhino
{
    /// <summary>
    /// RhinoCommon's public API, found by reflection inside the running Rhino so an answer is exactly the version the user
    /// has. The index is built once, on a background thread, after connecting; a lookup before it is ready answers with
    /// what is indexed so far and says so.
    /// </summary>
    internal sealed class ApiLookup
    {
        private readonly ApiIndex index = new ApiIndex();
        private Task? building;

        public ApiIndex Index => index;

        public void StartBuilding()
        {
            if (building != null) return;
            building = Task.Run(Build);
        }

        private void Build()
        {
            try
            {
                var assembly = typeof(RhinoDoc).Assembly;
                var summaries = ReadSummaries(assembly);
                Type[] types;
                try
                {
                    types = assembly.GetExportedTypes();
                }
                catch (ReflectionTypeLoadException partial)
                {
                    types = partial.Types.Where(t => t != null).Cast<Type>().ToArray();
                }

                foreach (var type in types.OrderBy(t => t.FullName, StringComparer.Ordinal))
                    index.Add(EntriesOf(type, summaries));
            }
            catch (Exception error)
            {
                RhinoApp.WriteLine("HAI: could not index RhinoCommon for the agent: " + error.Message);
            }
            finally
            {
                index.Finish();
            }
        }

        private static IEnumerable<ApiEntry> EntriesOf(Type type, Dictionary<string, string> summaries)
        {
            var typeName = Name(type);
            summaries.TryGetValue("T:" + type.FullName, out var typeSummary);
            yield return ApiIndex.Entry(type.FullName ?? typeName, "type", Kind(type) + " " + typeName, typeSummary);
            const BindingFlags flags = BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;
            foreach (var method in type.GetMethods(flags).Where(m => !m.IsSpecialName))
            {
                summaries.TryGetValue("M:" + type.FullName + "." + method.Name, out var summary);
                var prefix = method.IsStatic ? "static " : "";
                var parameters = string.Join(", ", method.GetParameters().Select(p => Name(p.ParameterType) + " " + p.Name));
                yield return ApiIndex.Entry(
                    type.FullName + "." + method.Name,
                    "method",
                    $"{prefix}{Name(method.ReturnType)} {method.Name}({parameters})",
                    summary);
            }

            foreach (var property in type.GetProperties(flags))
            {
                summaries.TryGetValue("P:" + type.FullName + "." + property.Name, out var summary);
                var access = property.CanWrite ? "{ get; set; }" : "{ get; }";
                yield return ApiIndex.Entry(
                    type.FullName + "." + property.Name,
                    "property",
                    $"{Name(property.PropertyType)} {property.Name} {access}",
                    summary);
            }

            foreach (var field in type.GetFields(flags))
            {
                summaries.TryGetValue("F:" + type.FullName + "." + field.Name, out var summary);
                yield return ApiIndex.Entry(type.FullName + "." + field.Name, "field", $"{Name(field.FieldType)} {field.Name}", summary);
            }

            foreach (var evt in type.GetEvents(flags))
            {
                summaries.TryGetValue("E:" + type.FullName + "." + evt.Name, out var summary);
                yield return ApiIndex.Entry(
                    type.FullName + "." + evt.Name,
                    "event",
                    $"event {(evt.EventHandlerType == null ? "" : Name(evt.EventHandlerType))} {evt.Name}",
                    summary);
            }
        }

        private static string Kind(Type type) =>
            type.IsEnum ? "enum" : type.IsInterface ? "interface" : type.IsValueType ? "struct" : "class";

        /// <summary>A type as C# writes it: "IEnumerable&lt;Curve&gt;" rather than "IEnumerable`1".</summary>
        private static string Name(Type type)
        {
            if (type.IsByRef) return "ref " + Name(type.GetElementType()!);
            if (type.IsArray) return Name(type.GetElementType()!) + "[]";
            if (!type.IsGenericType) return type.Name;
            var tick = type.Name.IndexOf('`');
            var bare = tick >= 0 ? type.Name.Substring(0, tick) : type.Name;
            return bare + "<" + string.Join(", ", type.GetGenericArguments().Select(Name)) + ">";
        }

        /// <summary>
        /// The summaries of RhinoCommon.xml beside the assembly, by member id without its parameters (the first overload's
        /// summary stands for all of them). None when the file is not there.
        /// </summary>
        private static Dictionary<string, string> ReadSummaries(Assembly assembly)
        {
            var summaries = new Dictionary<string, string>(StringComparer.Ordinal);
            var location = assembly.Location;
            if (string.IsNullOrEmpty(location)) return summaries;
            var xml = Path.ChangeExtension(location, ".xml");
            if (!File.Exists(xml)) return summaries;
            using (var reader = XmlReader.Create(xml, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit }))
            {
                while (reader.ReadToFollowing("member"))
                {
                    var id = reader.GetAttribute("name");
                    if (id == null) continue;
                    var paren = id.IndexOf('(');
                    var key = paren >= 0 ? id.Substring(0, paren) : id;
                    using (var member = reader.ReadSubtree())
                    {
                        if (!member.ReadToFollowing("summary")) continue;
                        var text = string.Join(" ", member.ReadElementContentAsString().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
                        if (!summaries.ContainsKey(key)) summaries[key] = text;
                    }
                }
            }

            return summaries;
        }
    }
}
