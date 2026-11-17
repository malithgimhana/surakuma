using Surakuma.Domain;

namespace Surakuma.Application;

public static class NotificationChannels
{
    public static bool ReceivesCitizenEmail(IEnumerable<string> roles)
    {
        var assigned = roles.ToArray();
        return assigned.Contains(Roles.Citizen);
    }
}
